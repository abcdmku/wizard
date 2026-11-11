import type { Scheduler } from '@openwizard/core'
import { createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import type { Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import { createPartyRuntime, type PartyRuntime, resumePartyRuntime } from '../src/index.js'

const roster = [
  { id: 'player-one', name: 'Ada' },
  { id: 'player-two', name: 'Lin' },
]

const viewer = (playerId: string): Viewer => ({
  tenantId: 'party-fast-tick',
  partyId: 'party-fast-tick',
  playerId,
  sessionId: `session:${playerId}`,
})

interface StoreCounts {
  commits: number
  dedupeClaims: number
  dedupeCompletions: number
}

const observedStore = (base: DurableStore) => {
  const counts: StoreCounts = { commits: 0, dedupeClaims: 0, dedupeCompletions: 0 }
  const store: DurableStore = {
    ...base,
    async commit(input) {
      counts.commits += 1
      if (input.completeDedupe !== undefined) counts.dedupeCompletions += 1
      return base.commit(input)
    },
    async claimDedupe(input) {
      counts.dedupeClaims += 1
      return base.claimDedupe(input)
    },
  }
  const reset = (): void => {
    counts.commits = 0
    counts.dedupeClaims = 0
    counts.dedupeCompletions = 0
  }
  return { store, counts, reset }
}

const openRuntime = async (
  store: DurableStore,
  options: {
    readonly ownerId?: string
    readonly scheduler?: Scheduler
    readonly leaseTtlMs?: number
    readonly onLeaseLost?: () => void
  } = {},
): Promise<PartyRuntime> => {
  const opened = await createPartyRuntime({
    partyId: 'party-fast-tick',
    store,
    ownerId: options.ownerId ?? 'owner-a',
    seed: 42,
    players: roster,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.leaseTtlMs === undefined ? {} : { leaseTtlMs: options.leaseTtlMs }),
    ...(options.onLeaseLost === undefined ? {} : { onLeaseLost: options.onLeaseLost }),
  })
  if (!opened.ok) throw new Error(`party did not open: ${opened.code}`)
  return opened.runtime
}

const connectAndReady = async (runtime: PartyRuntime): Promise<void> => {
  for (const player of roster) await runtime.connect(player.id)
  for (const player of roster) {
    const ack = await runtime.command(viewer(player.id), {
      commandId: `ready:${player.id}`,
      command: { type: 'ready', ready: true },
    })
    expect(ack.result.ok).toBe(true)
  }
  expect(runtime.state().phase).toBe('ready')
}

const enterExploration = async (runtime: PartyRuntime): Promise<void> => {
  await connectAndReady(runtime)
  await runtime.tick()
  await runtime.tick()
  expect(runtime.state().phase).toBe('exploration')
}

const expectQuiescent = async (runtime: PartyRuntime): Promise<void> => {
  const snapshot = runtime.host.run.getSnapshot()
  expect(runtime.host.version).toEqual({ epoch: snapshot.epoch, seq: snapshot.seq })
  const sequence = runtime.sequence()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(runtime.sequence()).toBe(sequence)
  const after = runtime.host.run.getSnapshot()
  expect(runtime.host.version).toEqual({ epoch: after.epoch, seq: after.seq })
}

describe('fast internal world ticks', () => {
  it('bypasses dedupe while preserving every fenced lifecycle commit', async () => {
    const observed = observedStore(createMemoryDurableStore())
    const runtime = await openRuntime(observed.store)
    await enterExploration(runtime)

    observed.reset()
    const tickBefore = runtime.state().tick
    const ack = await runtime.tick()
    expect(ack).toMatchObject({ result: { ok: true }, replayed: false, tick: tickBefore + 1 })
    // Ordinary handlers run after the delivery commit. Their synchronous update
    // and keep result share the second commit; internal ticks never claim IDs.
    expect(observed.counts).toEqual({ commits: 2, dedupeClaims: 0, dedupeCompletions: 0 })
    const settledCommits = observed.counts.commits
    await expectQuiescent(runtime)
    expect(observed.counts.commits).toBe(settledCommits)

    observed.reset()
    const command = await runtime.command(viewer('player-one'), {
      commandId: 'external-move',
      command: { type: 'move', direction: 'east' },
    })
    expect(command.result.ok).toBe(true)
    expect(observed.counts).toEqual({ commits: 3, dedupeClaims: 1, dedupeCompletions: 1 })
    await runtime.dispose()
  })

  it('settles phase-changing ticks before releasing the runtime gate', async () => {
    const observed = observedStore(createMemoryDurableStore())
    const runtime = await openRuntime(observed.store)
    for (const player of roster) await runtime.connect(player.id)
    await runtime.command(viewer('player-one'), {
      commandId: 'phase-ready-one',
      command: { type: 'ready', ready: true },
    })

    observed.reset()
    await runtime.command(viewer('player-two'), {
      commandId: 'phase-ready-two',
      command: { type: 'ready', ready: true },
    })
    expect(runtime.state().phase).toBe('ready')
    // The phase also resolves a dynamic next edge before the separate receipt
    // completion. A restart at that routing barrier must recover the phase.
    expect(observed.counts).toEqual({ commits: 4, dedupeClaims: 1, dedupeCompletions: 1 })
    const readyCommits = observed.counts.commits
    await expectQuiescent(runtime)
    expect(observed.counts.commits).toBe(readyCommits)

    observed.reset()
    await runtime.tick()
    expect(runtime.state().phase).toBe('generated')
    const generatedCommits = observed.counts.commits
    expect(generatedCommits).toBe(3)
    await expectQuiescent(runtime)
    expect(observed.counts.commits).toBe(generatedCommits)

    observed.reset()
    await runtime.tick()
    expect(runtime.state().phase).toBe('exploration')
    const explorationCommits = observed.counts.commits
    expect(explorationCommits).toBe(3)
    await expectQuiescent(runtime)
    expect(observed.counts.commits).toBe(explorationCommits)
    await runtime.dispose()
  })

  it('orders concurrent commands and ticks by gate admission', async () => {
    const runtime = await openRuntime(createMemoryDurableStore())
    await enterExploration(runtime)
    const player = runtime.state().players['player-one']
    if (player === undefined) throw new Error('player missing')

    const commandFirst = runtime.command(viewer(player.id), {
      commandId: 'command-first',
      expectedSequence: runtime.sequence(),
      command: { type: 'move', direction: 'east' },
    })
    const tickSecond = runtime.tick()
    const [commandAck, tickAck] = await Promise.all([commandFirst, tickSecond])
    expect(commandAck.result.ok).toBe(true)
    expect(tickAck.sequence).toBeGreaterThan(commandAck.sequence)
    expect(runtime.state().players[player.id]?.move).toEqual({ x: 0, y: 0 })

    const beforeStale = runtime.sequence()
    const tickFirst = runtime.tick()
    const commandSecond = runtime.command(viewer(player.id), {
      commandId: 'stale-after-tick',
      expectedSequence: beforeStale,
      command: { type: 'move', direction: 'west' },
    })
    const [nextTick, stale] = await Promise.all([tickFirst, commandSecond])
    expect(nextTick.result.ok).toBe(true)
    expect(stale.result).toMatchObject({ ok: false, code: 'STALE' })
    expect(stale.sequence).toBe(nextTick.sequence)
    await runtime.dispose()
  })

  it('resumes persisted tick progression monotonically', async () => {
    const store = createMemoryDurableStore()
    const runtime = await openRuntime(store)
    await enterExploration(runtime)
    await runtime.tick()
    const persistedTick = runtime.state().tick
    const persistedSequence = runtime.sequence()
    await runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: 'party-fast-tick',
      store,
      ownerId: 'owner-b',
    })
    if (!resumed.ok) throw new Error(`party did not resume: ${resumed.code}`)
    expect(resumed.runtime.state().tick).toBe(persistedTick)
    const resumedSequence = resumed.runtime.sequence()
    expect(resumedSequence).toBeGreaterThan(persistedSequence)
    await resumed.runtime.connect('player-one')
    const next = await resumed.runtime.tick()
    expect(next.result.ok).toBe(true)
    expect(resumed.runtime.state().tick).toBe(persistedTick + 1)
    expect(resumed.runtime.sequence()).toBeGreaterThan(resumedSequence)
    await resumed.runtime.dispose()
  })

  it('fails safe when a competing CAS takes the next snapshot version', async () => {
    const base = createMemoryDurableStore()
    let armed = false
    let replacement: unknown
    const store: DurableStore = {
      ...base,
      async commit(input) {
        if (armed && input.next !== undefined) {
          armed = false
          const competed = await base.commit({
            lease: input.lease,
            expected: input.expected,
            next: { value: replacement, version: input.next.version },
          })
          if (!competed.ok) throw new Error(`competing commit failed: ${competed.code}`)
        }
        return base.commit(input)
      },
    }
    let leaseLosses = 0
    const runtime = await openRuntime(store, { onLeaseLost: () => (leaseLosses += 1) })
    await enterExploration(runtime)
    const tickBefore = runtime.state().tick
    replacement = runtime.host.run.getSnapshot()
    armed = true

    const failed = await runtime.tick()
    expect(failed.result).toMatchObject({ ok: false, code: 'INTERNAL' })
    expect(failed.tick).toBe(tickBefore)
    expect(runtime.state().tick).toBe(tickBefore)
    expect(leaseLosses).toBe(1)
    await runtime.dispose()
  })

  it('fails safe when its lease expires before the tick commit', async () => {
    let now = 0
    const scheduler: Scheduler = {
      setTimeout: () => ({ timer: 'inert' }),
      clearTimeout: () => undefined,
    }
    const store = createMemoryDurableStore({ now: () => now })
    let leaseLosses = 0
    const runtime = await openRuntime(store, {
      scheduler,
      leaseTtlMs: 1_000,
      onLeaseLost: () => (leaseLosses += 1),
    })
    await enterExploration(runtime)
    const tickBefore = runtime.state().tick
    now = 2_000

    const failed = await runtime.tick()
    expect(failed.result).toMatchObject({ ok: false, code: 'INTERNAL' })
    expect(failed.tick).toBe(tickBefore)
    expect(runtime.state().tick).toBe(tickBefore)
    expect(leaseLosses).toBe(1)
    await runtime.dispose()
  })
})
