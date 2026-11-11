import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { createMemoryDurableStore, type MemoryDurableStore } from '@openwizard/durable'
import {
  createPartyRuntime,
  dungeonFlow,
  type PartyRuntime,
  resumePartyRuntime,
} from '@wizard/dungeon-server'
import { describe, expect, it } from 'vitest'

const PARTY_ID = 'party-runtime'
const OWNER = {
  tenantId: 'tenant-runtime-private',
  partyId: PARTY_ID,
  playerId: 'player-owner',
  sessionId: 'session-owner-private',
} as const
const TEAMMATE = {
  tenantId: 'tenant-runtime-private',
  partyId: PARTY_ID,
  playerId: 'player-teammate',
  sessionId: 'session-teammate-private',
} as const
const PLAYERS = [
  { id: OWNER.playerId, name: 'Owner' },
  { id: TEAMMATE.playerId, name: 'Teammate' },
] as const

interface RuntimeFixture {
  readonly runtime: PartyRuntime
  readonly scheduler: TestScheduler
  readonly store: MemoryDurableStore
}

async function createFixture(): Promise<RuntimeFixture> {
  const scheduler = createTestScheduler({ now: 25_000 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const opened = await createPartyRuntime({
    partyId: PARTY_ID,
    store,
    ownerId: 'process-one',
    seed: 44,
    players: PLAYERS,
    scheduler,
    clock: scheduler,
    leaseTtlMs: 3_000,
  })
  if (!opened.ok) throw new Error(`runtime open failed: ${opened.code}`)
  return { runtime: opened.runtime, scheduler, store }
}

async function connectParty(runtime: PartyRuntime): Promise<void> {
  await runtime.connect(OWNER.playerId)
  await runtime.connect(TEAMMATE.playerId)
  await runtime.tick()
}

describe('durable dungeonFlow runtime', () => {
  it('drives lobby generation with virtual time and explicit deterministic ticks', async () => {
    const { runtime, scheduler } = await createFixture()
    expect(runtime.host.run.getSnapshot().wizard).toEqual({
      name: dungeonFlow.name,
      version: dungeonFlow.version,
    })
    expect(scheduler.now()).toBe(25_000)

    await connectParty(runtime)
    const ownerReady = await runtime.command(OWNER, {
      commandId: 'owner-ready',
      command: { type: 'ready', ready: true },
    })
    const teammateReady = await runtime.command(TEAMMATE, {
      commandId: 'teammate-ready',
      command: { type: 'ready', ready: true },
    })
    expect(ownerReady.result).toEqual({ ok: true })
    expect(teammateReady.result).toEqual({ ok: true })
    expect(runtime.state().phase).toBe('ready')

    await runtime.tick()
    expect(runtime.state().phase).toBe('generated')
    await runtime.tick()
    expect(runtime.state().phase).toBe('exploration')
    expect(runtime.state().tick).toBe(3)
    expect(scheduler.now()).toBe(25_000)
    await runtime.dispose()
  })

  it('rejects stale and cross-party commands without changing state', async () => {
    const { runtime } = await createFixture()
    await connectParty(runtime)
    const before = runtime.sequence()
    const accepted = await runtime.command(OWNER, {
      commandId: 'fresh-ready',
      expectedSequence: before,
      command: { type: 'ready', ready: true },
    })
    expect(accepted.result).toEqual({ ok: true })

    const stale = await runtime.command(TEAMMATE, {
      commandId: 'stale-ready',
      expectedSequence: before,
      command: { type: 'ready', ready: true },
    })
    expect(stale.result).toMatchObject({ ok: false, code: 'STALE' })
    expect(runtime.state().players[TEAMMATE.playerId]?.ready).toBe(false)

    const crossParty = await runtime.command(
      { ...OWNER, partyId: 'party-foreign' },
      { commandId: 'cross-party', command: { type: 'ready', ready: false } },
    )
    expect(crossParty.result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(runtime.state().players[OWNER.playerId]?.ready).toBe(true)
    await runtime.dispose()
  })

  it('replays the same player commandId after a host restart without applying it twice', async () => {
    const { runtime, scheduler, store } = await createFixture()
    await connectParty(runtime)
    const input = {
      commandId: 'durable-ready',
      command: { type: 'ready' as const, ready: true },
    }
    const first = await runtime.command(OWNER, input)
    const sequenceAfterFirst = runtime.sequence()
    const duplicate = await runtime.command(OWNER, input)
    expect(first.replayed).toBe(false)
    expect(duplicate.replayed).toBe(true)
    expect(runtime.sequence()).toBe(sequenceAfterFirst)
    await runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: PARTY_ID,
      store,
      ownerId: 'process-two',
      scheduler,
      clock: scheduler,
      leaseTtlMs: 3_000,
    })
    if (!resumed.ok) throw new Error(`runtime resume failed: ${resumed.code}`)
    const sequenceBeforeReplay = resumed.runtime.sequence()
    const replayed = await resumed.runtime.command(OWNER, input)
    expect(replayed).toMatchObject({ replayed: true, result: { ok: true } })
    expect(resumed.runtime.sequence()).toBe(sequenceBeforeReplay)
    expect(resumed.runtime.state().players[OWNER.playerId]?.ready).toBe(true)

    const conflict = await resumed.runtime.command(OWNER, {
      commandId: input.commandId,
      command: { type: 'ready', ready: false },
    })
    expect(conflict.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(resumed.runtime.state().players[OWNER.playerId]?.ready).toBe(true)
    await resumed.runtime.dispose()
  })
})
