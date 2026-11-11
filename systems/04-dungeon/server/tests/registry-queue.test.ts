import type { Scheduler } from '@openwizard/core'
import { createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commandResultKey,
  createMemoryPartyDirectory,
  createMemoryPartyRepository,
  createPartyRegistry,
  type PartyRegistry,
  type RegistryScheduler,
} from '../src/index.js'

const PARTY_ID = 'party-one'
const roster = [
  { id: 'player-one', name: 'Ada' },
  { id: 'player-two', name: 'Lin' },
]
const viewer = {
  tenantId: PARTY_ID,
  partyId: PARTY_ID,
  playerId: 'player-one',
  sessionId: 'session:player-one',
} as const

const deferred = () => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const waitFor = async (condition: () => boolean, message: string): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

const pulseScheduler = () => {
  let pulseHandler: (() => void) | undefined
  const timeouts = new Map<ReturnType<typeof setTimeout>, { callback: () => void; delay: number }>()
  const scheduler: RegistryScheduler = {
    setInterval: (callback) => {
      pulseHandler = callback
      return setTimeout(() => undefined, 60_000)
    },
    clearInterval: (handle) => {
      clearTimeout(handle)
      pulseHandler = undefined
    },
    setTimeout: (callback, delay) => {
      const handle = setTimeout(() => undefined, 60_000)
      timeouts.set(handle, { callback, delay })
      return handle
    },
    clearTimeout: (handle) => {
      timeouts.delete(handle)
      clearTimeout(handle)
    },
  }
  return {
    scheduler,
    pulse: () => {
      if (pulseHandler === undefined) throw new Error('registry scheduler did not start')
      pulseHandler()
      const due = [...timeouts].filter(([, timeout]) => timeout.delay === 0)
      for (const [handle, timeout] of due) {
        timeouts.delete(handle)
        clearTimeout(handle)
        timeout.callback()
      }
    },
  }
}

const openRegistries = new Set<PartyRegistry>()
const track = (registry: PartyRegistry): PartyRegistry => {
  openRegistries.add(registry)
  return registry
}

afterEach(async () => {
  const registries = [...openRegistries]
  openRegistries.clear()
  await Promise.all(registries.map((registry) => registry.stop()))
})

describe('bounded registry tick admission', () => {
  it('admits one follow-up, drops later pulses, and preserves pulse-time FIFO order', async () => {
    const repository = createMemoryPartyRepository()
    const commandEntered = deferred()
    const releaseCommand = deferred()
    let pauseFirstCommand = true
    const store: DurableStore = {
      ...repository.store,
      async claimDedupe(input) {
        if (
          pauseFirstCommand &&
          input.id === `dungeon-command:${commandResultKey('player-one', 'first-command')}`
        ) {
          pauseFirstCommand = false
          commandEntered.resolve()
          await releaseCommand.promise
        }
        return repository.store.claimDedupe(input)
      },
    }
    const pulses = pulseScheduler()
    const registry = track(
      createPartyRegistry({
        store,
        directory: repository.directory,
        ownerId: 'bounded-tick-registry',
        scheduler: pulses.scheduler,
      }),
    )
    await registry.start()
    const seeded = await registry.seed({ partyId: PARTY_ID, seed: 42, players: roster })
    if (!seeded.ok) throw new Error('party did not seed')
    const runtime = seeded.runtime
    await runtime.connect('player-one')
    const tickCompletions: number[] = []
    const originalTick = runtime.tick.bind(runtime)
    Object.defineProperty(runtime, 'tick', {
      configurable: true,
      value: async () => {
        const ack = await originalTick()
        tickCompletions.push(ack.sequence)
        return ack
      },
    })

    const firstCommand = runtime.command(viewer, {
      commandId: 'first-command',
      command: { type: 'ready', ready: false },
    })
    await commandEntered.promise
    pulses.pulse()
    const betweenCommand = runtime.command(viewer, {
      commandId: 'between-command',
      command: { type: 'ready', ready: false },
    })
    pulses.pulse()
    pulses.pulse()
    for (let index = 0; index < 8; index += 1) pulses.pulse()
    expect(registry.tickStats(PARTY_ID)).toEqual({
      pulses: 11,
      admitted: 2,
      completed: 0,
      dropped: 9,
    })

    releaseCommand.resolve()
    const [firstAck, betweenAck] = await Promise.all([firstCommand, betweenCommand])
    await waitFor(
      () => registry.tickStats(PARTY_ID).completed === 2,
      'admitted ticks did not settle',
    )

    expect(tickCompletions).toHaveLength(2)
    const firstTick = tickCompletions[0]
    const secondTick = tickCompletions[1]
    if (firstTick === undefined || secondTick === undefined) throw new Error('tick missing')
    expect(firstTick).toBeGreaterThan(firstAck.sequence)
    expect(betweenAck.sequence).toBeGreaterThan(firstTick)
    expect(secondTick).toBeGreaterThan(betweenAck.sequence)
    expect(runtime.state().tick).toBe(2)
    expect(registry.tickStats(PARTY_ID)).toEqual({
      pulses: 11,
      admitted: 2,
      completed: 2,
      dropped: 9,
    })
  })

  it('lets the final disconnect neutralize an already admitted tick', async () => {
    const repository = createMemoryPartyRepository()
    const pulses = pulseScheduler()
    const registry = track(
      createPartyRegistry({
        store: repository.store,
        directory: repository.directory,
        ownerId: 'disconnect-tick-registry',
        scheduler: pulses.scheduler,
      }),
    )
    await registry.start()
    const seeded = await registry.seed({ partyId: PARTY_ID, seed: 42, players: roster })
    if (!seeded.ok) throw new Error('party did not seed')
    const runtime = seeded.runtime
    await runtime.connect('player-one')
    const tickBefore = runtime.state().tick
    const disconnecting = runtime.disconnect('player-one')
    pulses.pulse()
    await disconnecting
    await waitFor(
      () => registry.tickStats(PARTY_ID).completed === 1,
      'neutralized tick did not settle',
    )
    expect(runtime.state().tick).toBe(tickBefore)
    const sequence = runtime.sequence()
    pulses.pulse()
    expect(runtime.sequence()).toBe(sequence)
    expect(registry.tickStats(PARTY_ID)).toEqual({
      pulses: 1,
      admitted: 1,
      completed: 1,
      dropped: 0,
    })
  })

  it('fails closed on lease loss and admits a fresh runtime generation', async () => {
    let now = 0
    const wizardScheduler: Scheduler = {
      setTimeout: () => ({ timer: 'inert' }),
      clearTimeout: () => undefined,
    }
    const pulses = pulseScheduler()
    const registry = track(
      createPartyRegistry({
        store: createMemoryDurableStore({ now: () => now }),
        directory: createMemoryPartyDirectory(),
        ownerId: 'invalidated-tick-registry',
        scheduler: pulses.scheduler,
        wizardScheduler,
        clock: { now: () => now },
        leaseTtlMs: 1_000,
      }),
    )
    await registry.start()
    const seeded = await registry.seed({ partyId: PARTY_ID, seed: 42, players: roster })
    if (!seeded.ok) throw new Error('party did not seed')
    await seeded.runtime.connect('player-one')
    const tickBefore = seeded.runtime.state().tick
    now = 2_000
    pulses.pulse()
    await waitFor(() => registry.cached(PARTY_ID) === undefined, 'runtime was not invalidated')
    expect(seeded.runtime.state().tick).toBe(tickBefore)
    expect(registry.tickStats(PARTY_ID)).toEqual({
      pulses: 1,
      admitted: 1,
      completed: 0,
      dropped: 0,
    })
    pulses.pulse()
    expect(registry.tickStats(PARTY_ID).pulses).toBe(1)

    const reopened = await registry.get(PARTY_ID)
    if (!reopened.ok) throw new Error(`party did not reopen: ${reopened.code}`)
    await reopened.runtime.connect('player-one')
    pulses.pulse()
    await waitFor(
      () => registry.tickStats(PARTY_ID).completed === 1,
      'replacement tick did not settle',
    )
    expect(reopened.runtime.state().tick).toBe(tickBefore + 1)
    expect(registry.tickStats(PARTY_ID)).toEqual({
      pulses: 2,
      admitted: 2,
      completed: 1,
      dropped: 0,
    })
  })
})
