import type { Scheduler } from '@openwizard/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryPartyRepository,
  createPartyRegistry,
  type PartyRegistry,
  type PartyRuntime,
  type RegistryScheduler,
  type RuntimeAck,
} from '../src/index.js'

const wizardScheduler: Scheduler = {
  setTimeout: () => ({ timer: 'inert' }),
  clearTimeout: () => undefined,
}

const registries = new Set<PartyRegistry>()
const track = (registry: PartyRegistry): PartyRegistry => {
  registries.add(registry)
  return registry
}
const stop = async (registry: PartyRegistry): Promise<void> => {
  await registry.stop()
  registries.delete(registry)
}

beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  const pending = [...registries]
  registries.clear()
  await Promise.all(pending.map((registry) => registry.stop()))
  vi.useRealTimers()
})

const createRegistry = (scheduler?: RegistryScheduler): PartyRegistry => {
  const repository = createMemoryPartyRepository()
  return track(
    createPartyRegistry({
      store: repository.store,
      directory: repository.directory,
      ownerId: 'phase-registry',
      wizardScheduler,
      ...(scheduler === undefined ? {} : { scheduler }),
    }),
  )
}

const seedParty = async (
  registry: PartyRegistry,
  partyId: string,
  connected: boolean,
): Promise<PartyRuntime> => {
  const playerId = `${partyId}-player`
  const opened = await registry.seed({
    partyId,
    seed: 42,
    players: [
      { id: playerId, name: 'Ada' },
      { id: `${partyId}-teammate`, name: 'Lin' },
    ],
  })
  if (!opened.ok) throw new Error(`party did not seed: ${partyId}`)
  if (connected) await opened.runtime.connect(playerId)
  return opened.runtime
}

const successAck = (runtime: PartyRuntime): RuntimeAck => ({
  result: { ok: true },
  replayed: false,
  sequence: runtime.sequence(),
  tick: runtime.state().tick,
})

const probeTicks = (runtime: PartyRuntime, calls: number[]): void => {
  Object.defineProperty(runtime, 'tick', {
    configurable: true,
    value: () => {
      calls.push(Date.now())
      return Promise.resolve(successAck(runtime))
    },
  })
}

const deferredAck = () => {
  let resolve = (_ack: RuntimeAck): void => undefined
  const promise = new Promise<RuntimeAck>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const stalledScheduler = () => {
  let cycle: (() => void) | undefined
  const timeouts = new Map<
    ReturnType<typeof setTimeout>,
    { readonly callback: () => void; readonly delay: number }
  >()
  const handle = () => setTimeout(() => undefined, 60_000)
  const scheduler: RegistryScheduler = {
    setInterval: (callback) => {
      cycle = callback
      return handle()
    },
    clearInterval: (timer) => {
      clearTimeout(timer)
      cycle = undefined
    },
    setTimeout: (callback, delay) => {
      const timer = handle()
      timeouts.set(timer, { callback, delay })
      return timer
    },
    clearTimeout: (timer) => {
      timeouts.delete(timer)
      clearTimeout(timer)
    },
  }
  return {
    scheduler,
    cycle: () => {
      if (cycle === undefined) throw new Error('cycle did not start')
      cycle()
    },
    pending: () => [...timeouts.keys()],
    fire: (timer: ReturnType<typeof setTimeout>) => {
      const task = timeouts.get(timer)
      if (task === undefined) throw new Error('phase timer is not pending')
      timeouts.delete(timer)
      clearTimeout(timer)
      task.callback()
    },
  }
}

describe('phase-staggered registry cycles', () => {
  it('gives 20 live parties ten evenly phased pulses in one second', async () => {
    const registry = createRegistry()
    const runtimes = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        seedParty(registry, `party-${index.toString().padStart(2, '0')}`, true),
      ),
    )
    const calls = runtimes.map((): number[] => [])
    for (let index = 0; index < runtimes.length; index += 1) {
      const runtime = runtimes[index]
      const runtimeCalls = calls[index]
      if (runtime !== undefined && runtimeCalls !== undefined) probeTicks(runtime, runtimeCalls)
    }

    const origin = Date.now()
    await registry.start()
    await vi.advanceTimersByTimeAsync(999)
    await Promise.resolve()

    expect(calls.every((partyCalls) => partyCalls.length === 10)).toBe(true)
    expect(calls.map((partyCalls) => (partyCalls[0] ?? -1) - origin)).toEqual(
      Array.from({ length: 20 }, (_, index) => index * 5),
    )
    for (const runtime of runtimes) {
      expect(registry.tickStats(runtime.partyId)).toEqual({
        pulses: 10,
        admitted: 10,
        completed: 10,
        dropped: 0,
      })
    }
  })

  it('never admits more than two ticks for one blocked party', async () => {
    const registry = createRegistry()
    const runtime = await seedParty(registry, 'party-blocked', true)
    const first = deferredAck()
    const second = deferredAck()
    let tickCalls = 0
    Object.defineProperty(runtime, 'tick', {
      configurable: true,
      value: () => {
        tickCalls += 1
        if (tickCalls === 1) return first.promise
        if (tickCalls === 2) return second.promise
        return Promise.reject(new Error('tick cap was exceeded'))
      },
    })

    await registry.start()
    await vi.advanceTimersByTimeAsync(499)
    expect(tickCalls).toBe(2)
    expect(registry.tickStats(runtime.partyId)).toEqual({
      pulses: 5,
      admitted: 2,
      completed: 0,
      dropped: 3,
    })
    first.resolve(successAck(runtime))
    second.resolve(successAck(runtime))
    await Promise.resolve()
    await Promise.resolve()
    expect(registry.tickStats(runtime.partyId).completed).toBe(2)
  })

  it('retains delayed handles and rejects a stale runtime identity', async () => {
    const stalled = stalledScheduler()
    const registry = createRegistry(stalled.scheduler)
    const first = await seedParty(registry, 'party-a', true)
    const second = await seedParty(registry, 'party-b', true)
    const firstCalls: number[] = []
    const secondCalls: number[] = []
    probeTicks(first, firstCalls)
    probeTicks(second, secondCalls)
    await registry.start()
    const originalHandles = stalled.pending()
    expect(originalHandles).toHaveLength(2)

    stalled.cycle()
    expect(stalled.pending()).toEqual(originalHandles)
    const cached = registry.cached.bind(registry)
    Object.defineProperty(registry, 'cached', {
      configurable: true,
      value: (partyId: string) => (partyId === first.partyId ? undefined : cached(partyId)),
    })
    for (const timer of originalHandles) stalled.fire(timer)
    await Promise.resolve()
    expect([firstCalls.length, secondCalls.length]).toEqual([0, 1])

    stalled.cycle()
    expect(stalled.pending()).toHaveLength(2)
  })

  it('adds and idles parties only on later cycles without duplicate starts', async () => {
    const registry = createRegistry()
    const first = await seedParty(registry, 'party-a', true)
    const idle = await seedParty(registry, 'party-idle', false)
    const firstCalls: number[] = []
    const idleCalls: number[] = []
    probeTicks(first, firstCalls)
    probeTicks(idle, idleCalls)

    await registry.start()
    await vi.advanceTimersByTimeAsync(49)
    expect([firstCalls.length, idleCalls.length]).toEqual([1, 0])
    const second = await seedParty(registry, 'party-b', true)
    const secondCalls: number[] = []
    probeTicks(second, secondCalls)
    await vi.advanceTimersByTimeAsync(52)
    await first.disconnect('party-a-player')
    await vi.advanceTimersByTimeAsync(100)
    expect([firstCalls.length, secondCalls.length]).toEqual([2, 2])

    await registry.start()
    await vi.advanceTimersByTimeAsync(97)
    expect([firstCalls.length, secondCalls.length]).toEqual([2, 2])
    expect(registry.tickStats(first.partyId).pulses).toBe(2)
    expect(registry.tickStats(second.partyId).pulses).toBe(2)
    expect(registry.tickStats(idle.partyId).pulses).toBe(0)
    expect(idleCalls).toHaveLength(0)
  })

  it('keeps tickAll immediate and cancels every pending background callback on stop', async () => {
    const registry = createRegistry()
    const first = await seedParty(registry, 'party-a', true)
    const second = await seedParty(registry, 'party-b', true)
    const firstCalls: number[] = []
    const secondCalls: number[] = []
    probeTicks(first, firstCalls)
    probeTicks(second, secondCalls)

    await registry.tickAll()
    expect([firstCalls.length, secondCalls.length]).toEqual([1, 1])
    expect(firstCalls[0]).toBe(secondCalls[0])

    await registry.start()
    await vi.advanceTimersByTimeAsync(0)
    expect([firstCalls.length, secondCalls.length]).toEqual([2, 1])
    await stop(registry)
    await vi.advanceTimersByTimeAsync(1_000)
    expect([firstCalls.length, secondCalls.length]).toEqual([2, 1])
    expect(vi.getTimerCount()).toBe(0)
  })
})
