import { createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import type { Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import {
  commandResultKey,
  createMemoryPartyRepository,
  createPartyRuntime,
  dungeonWizard,
  migrateDungeonSnapshot,
  type PartyRuntime,
  resumePartyRuntime,
} from '../src/index.js'

const PARTY_ID = 'receipt-party'
const PLAYER_ID = 'receipt-player'
const roster = [
  { id: PLAYER_ID, name: 'Ada' },
  { id: 'receipt-teammate', name: 'Lin' },
]
const viewer: Viewer = {
  tenantId: PARTY_ID,
  partyId: PARTY_ID,
  playerId: PLAYER_ID,
  sessionId: 'receipt-session',
}

const open = async () => {
  const repository = createMemoryPartyRepository()
  const opened = await createPartyRuntime({
    partyId: PARTY_ID,
    store: repository.store,
    ownerId: 'receipt-owner-a',
    seed: 42,
    players: roster,
  })
  if (!opened.ok) throw new Error('party did not open')
  await opened.runtime.connect(PLAYER_ID)
  return { repository, runtime: opened.runtime }
}

const fillWithLobbySuccesses = async (runtime: PartyRuntime, prefix: string): Promise<void> => {
  for (let index = 0; index < 129; index += 1) {
    const ack = await runtime.command(viewer, {
      commandId: `${prefix}-${index}`,
      command: { type: 'ready', ready: index % 2 === 0 },
    })
    expect(ack.result).toEqual({ ok: true })
  }
}

const resultKeys = (runtime: PartyRuntime): readonly string[] => {
  const recent = runtime.host.run.getState().context.lastCommandReceipt
  return recent === undefined ? [] : [recent.key]
}

describe('durable command receipts', () => {
  it('strictly bounds failed results retained in the run snapshot', async () => {
    const { runtime } = await open()
    for (let index = 0; index < 129; index += 1) {
      const ack = await runtime.command(viewer, {
        commandId: `failed-move-${index}`,
        command: { type: 'move', direction: 'east' },
      })
      expect(ack.result).toEqual({
        ok: false,
        code: 'INVALID_COMMAND',
        message: 'party is not active',
      })
    }

    const context = runtime.host.run.getState().context
    expect(resultKeys(runtime)).toEqual([commandResultKey(PLAYER_ID, 'failed-move-128')])
    expect(Object.keys(context.commandResults ?? {})).toHaveLength(0)
    expect(context.commandOrder ?? []).toHaveLength(0)
    await runtime.dispose()
  })

  it('replays an evicted success after later state would deny it', async () => {
    const { runtime } = await open()
    const input = {
      commandId: 'success-before-death',
      command: { type: 'ready' as const, ready: false },
    }
    expect(await runtime.command(viewer, input)).toMatchObject({
      result: { ok: true },
      replayed: false,
    })
    await fillWithLobbySuccesses(runtime, 'success-after')
    expect(resultKeys(runtime)).not.toContain(commandResultKey(PLAYER_ID, input.commandId))

    const player = runtime.state().players[PLAYER_ID]
    if (player === undefined) throw new Error('player fixture missing')
    player.health = 0
    const before = runtime.sequence()
    expect(await runtime.command(viewer, input)).toEqual({
      result: { ok: true },
      replayed: true,
      sequence: before,
      tick: runtime.state().tick,
    })
    expect(runtime.sequence()).toBe(before)
    await runtime.dispose()
  })

  it('replays an evicted failure across restart after the denial no longer applies', async () => {
    const { repository, runtime } = await open()
    const player = runtime.state().players[PLAYER_ID]
    if (player === undefined) throw new Error('player fixture missing')
    player.health = 0
    const input = {
      commandId: 'failure-before-revival',
      command: { type: 'ready' as const, ready: true },
    }
    const beforeDenial = runtime.sequence()
    const first = await runtime.command(viewer, input)
    expect(first.result).toEqual({
      ok: false,
      code: 'INVALID_COMMAND',
      message: 'defeated players can only request a rematch',
    })
    expect(runtime.sequence()).toBe(beforeDenial)

    player.health = player.maxHealth
    await fillWithLobbySuccesses(runtime, 'success-after-revival')
    expect(resultKeys(runtime)).not.toContain(commandResultKey(PLAYER_ID, input.commandId))
    await runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: PARTY_ID,
      store: repository.store,
      ownerId: 'receipt-owner-b',
    })
    if (!resumed.ok) throw new Error('party did not resume')
    const beforeReplay = resumed.runtime.sequence()
    expect(await resumed.runtime.command(viewer, input)).toMatchObject({
      result: first.result,
      replayed: true,
    })
    expect(resumed.runtime.sequence()).toBe(beforeReplay)

    const conflict = await resumed.runtime.command(viewer, {
      commandId: input.commandId,
      command: { type: 'ready', ready: false },
    })
    expect(conflict.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(resumed.runtime.sequence()).toBe(beforeReplay)
    await resumed.runtime.dispose()
  })

  it('claims and completes a preflight denial without a snapshot commit', async () => {
    const base = createMemoryDurableStore()
    const counts = { claims: 0, commits: 0, completions: 0, snapshots: 0 }
    const store: DurableStore = {
      ...base,
      async claimDedupe(input) {
        counts.claims += 1
        return base.claimDedupe(input)
      },
      async commit(input) {
        counts.commits += 1
        if (input.completeDedupe !== undefined) counts.completions += 1
        if (input.next !== undefined) counts.snapshots += 1
        return base.commit(input)
      },
    }
    const opened = await createPartyRuntime({
      partyId: PARTY_ID,
      store,
      ownerId: 'receipt-denial-owner',
      seed: 42,
      players: roster,
    })
    if (!opened.ok) throw new Error('party did not open')
    await opened.runtime.connect(PLAYER_ID)
    const player = opened.runtime.state().players[PLAYER_ID]
    if (player === undefined) throw new Error('player fixture missing')
    player.health = 0
    counts.claims = 0
    counts.commits = 0
    counts.completions = 0
    counts.snapshots = 0
    const before = opened.runtime.sequence()

    const denied = await opened.runtime.command(viewer, {
      commandId: 'counted-denial',
      command: { type: 'ready', ready: true },
    })
    expect(denied.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(opened.runtime.sequence()).toBe(before)
    expect(counts).toEqual({ claims: 1, commits: 1, completions: 1, snapshots: 0 })
    await opened.runtime.dispose()
  })

  it('migrates v1 result maps out of the snapshot context', async () => {
    const { runtime } = await open()
    const snapshot = runtime.host.run.getSnapshot()
    const world = runtime.state()
    const legacy = {
      ...snapshot,
      wizard: { ...snapshot.wizard, version: 1 },
      state: {
        ...snapshot.state,
        wizard: { ...snapshot.state.wizard, version: 1 },
        context: {
          world,
          commandResults: { legacy: { ok: true } },
          commandOrder: ['legacy'],
        },
      },
    }
    const migrated = migrateDungeonSnapshot(legacy, { name: dungeonWizard.name, version: 1 })
    expect(migrated).toMatchObject({
      wizard: { name: dungeonWizard.name, version: dungeonWizard.version },
      state: {
        wizard: { name: dungeonWizard.name, version: dungeonWizard.version },
        context: { world },
      },
    })
    expect(JSON.stringify(migrated)).not.toContain('commandResults')
    const resumed = dungeonWizard.resume(legacy, { migrate: migrateDungeonSnapshot })
    expect(resumed.getState().context).toEqual({ world })
    resumed.dispose()
    await runtime.dispose()
  })

  it('fails closed when a v2 world phase disagrees with its active wait', async () => {
    const { repository, runtime } = await open()
    const snapshot = runtime.host.run.getSnapshot()
    const malformed = {
      ...snapshot,
      state: {
        ...snapshot.state,
        context: {
          ...snapshot.state.context,
          world: { ...snapshot.state.context.world, phase: 'boss' as const },
        },
      },
    }
    await runtime.dispose()
    const store: DurableStore = {
      ...repository.store,
      async acquire(key, ownerId, options) {
        const acquired = await repository.store.acquire(key, ownerId, options)
        if (!acquired.ok || acquired.record === null) return acquired
        return { ...acquired, record: { ...acquired.record, value: malformed } }
      },
    }

    const resumed = await resumePartyRuntime({
      partyId: PARTY_ID,
      store,
      ownerId: 'malformed-v2-owner',
    })
    expect(resumed).toEqual({ ok: false, code: 'LEASE_LOST' })
  })
})
