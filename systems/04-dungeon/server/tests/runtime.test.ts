import type { Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import {
  createMemoryPartyRepository,
  createPartyRegistry,
  createPartyRuntime,
  resumePartyRuntime,
} from '../src/index.js'

const roster = [
  { id: 'player-one', name: 'Ada' },
  { id: 'player-two', name: 'Lin' },
]

const viewer = (playerId: string): Viewer => ({
  tenantId: 'party-one',
  partyId: 'party-one',
  playerId,
  sessionId: `session:${playerId}`,
})

describe('durable party runtime', () => {
  it('deduplicates player-scoped command IDs across a restart', async () => {
    const repository = createMemoryPartyRepository()
    const opened = await createPartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-a',
      seed: 42,
      players: roster,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error('party did not open')
    await opened.runtime.connect('player-one')
    await opened.runtime.connect('player-two')
    const first = await opened.runtime.command(viewer('player-one'), {
      commandId: 'ready-once',
      command: { type: 'ready', ready: true },
    })
    expect(first).toMatchObject({ result: { ok: true }, replayed: false })
    await opened.runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-b',
    })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) throw new Error('party did not resume')
    const before = resumed.runtime.sequence()
    const replay = await resumed.runtime.command(viewer('player-one'), {
      commandId: 'ready-once',
      command: { type: 'ready', ready: true },
    })
    expect(replay).toMatchObject({ result: { ok: true }, replayed: true })
    expect(resumed.runtime.sequence()).toBe(before)
    await resumed.runtime.dispose()
  })

  it('keeps equal command IDs from different players separate', async () => {
    const repository = createMemoryPartyRepository()
    const opened = await createPartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-a',
      seed: 42,
      players: roster,
    })
    if (!opened.ok) throw new Error('party did not open')
    await opened.runtime.connect('player-one')
    await opened.runtime.connect('player-two')
    const first = await opened.runtime.command(viewer('player-one'), {
      commandId: 'same-id',
      command: { type: 'ready', ready: true },
    })
    const second = await opened.runtime.command(viewer('player-two'), {
      commandId: 'same-id',
      command: { type: 'ready', ready: true },
    })
    expect(first.result.ok).toBe(true)
    expect(second.result.ok).toBe(true)
    expect(opened.runtime.state().phase).toBe('ready')
    await opened.runtime.dispose()
  })

  it('replays an old successful command after its bounded result entry is evicted', async () => {
    const repository = createMemoryPartyRepository()
    const opened = await createPartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-a',
      seed: 42,
      players: roster,
    })
    if (!opened.ok) throw new Error('party did not open')
    await opened.runtime.connect('player-one')
    const first = await opened.runtime.command(viewer('player-one'), {
      commandId: 'old-success',
      command: { type: 'ready', ready: false },
    })
    expect(first.result.ok).toBe(true)
    for (let index = 0; index < 129; index += 1) {
      const result = await opened.runtime.command(viewer('player-one'), {
        commandId: `later-success-${index}`,
        command: { type: 'ready', ready: index % 2 === 0 },
      })
      expect(result.result.ok).toBe(true)
    }
    await opened.runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-b',
    })
    if (!resumed.ok) throw new Error('party did not resume')
    const before = resumed.runtime.sequence()
    const replay = await resumed.runtime.command(viewer('player-one'), {
      commandId: 'old-success',
      command: { type: 'ready', ready: false },
    })
    expect(replay).toMatchObject({ result: { ok: true }, replayed: true })
    expect(resumed.runtime.sequence()).toBe(before)
    await resumed.runtime.dispose()
  })

  it('keeps bound-key authorization and durable replays stable across restart', async () => {
    const repository = createMemoryPartyRepository()
    const opened = await createPartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-a',
      seed: 42,
      players: roster,
    })
    if (!opened.ok) throw new Error('party did not open')
    let runtime = opened.runtime
    await runtime.connect('player-one')
    await runtime.connect('player-two')
    for (const playerId of ['player-one', 'player-two']) {
      await runtime.command(viewer(playerId), {
        commandId: `initial-ready:${playerId}`,
        command: { type: 'ready', ready: true },
      })
    }
    await runtime.tick()
    await runtime.tick()

    const owner = runtime.state().players['player-one']
    const key = runtime.state().loot['loot:bound-key']
    const door = runtime.state().fixtures['fixture:shared-door']
    if (owner === undefined || key === undefined || door === undefined) {
      throw new Error('key fixtures were not generated')
    }
    owner.x = key.x
    owner.y = key.y
    const pickup = {
      commandId: 'durable-key-pickup',
      command: { type: 'pickup' as const, lootId: key.id },
    }
    expect((await runtime.command(viewer(owner.id), pickup)).result.ok).toBe(true)
    const deniedPickup = {
      commandId: 'teammate-key-pickup',
      command: { type: 'pickup' as const, lootId: key.id },
    }
    const afterPickup = runtime.sequence()
    expect(await runtime.command(viewer('player-two'), deniedPickup)).toMatchObject({
      result: { ok: false, code: 'KEY_NOT_OWNED' },
    })
    expect(await runtime.command(viewer(owner.id), pickup)).toMatchObject({
      result: { ok: true },
      replayed: true,
    })
    expect(runtime.sequence()).toBe(afterPickup)
    await runtime.dispose()

    const pickedResume = await resumePartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-b',
    })
    if (!pickedResume.ok) throw new Error('picked party did not resume')
    runtime = pickedResume.runtime
    await runtime.connect('player-one')
    await runtime.connect('player-two')
    const afterRestart = runtime.sequence()
    expect(await runtime.command(viewer('player-two'), deniedPickup)).toMatchObject({
      result: { ok: false, code: 'KEY_NOT_OWNED' },
    })
    expect(await runtime.command(viewer(owner.id), pickup)).toMatchObject({ replayed: true })
    expect(runtime.sequence()).toBe(afterRestart)

    const ownerWithKey = runtime.state().players[owner.id]
    const resumedDoor = runtime.state().fixtures[door.id]
    if (ownerWithKey === undefined || resumedDoor === undefined) {
      throw new Error('key fixtures did not resume')
    }
    ownerWithKey.x = resumedDoor.x
    ownerWithKey.y = resumedDoor.y
    const unlock = {
      commandId: 'durable-door-unlock',
      command: { type: 'interact' as const, targetId: door.id },
    }
    expect((await runtime.command(viewer(owner.id), unlock)).result.ok).toBe(true)

    await runtime.reset(43, 'reset-after-unlock')
    for (const playerId of ['player-one', 'player-two']) {
      await runtime.command(viewer(playerId), {
        commandId: `reset-ready:${playerId}`,
        command: { type: 'ready', ready: true },
      })
    }
    await runtime.tick()
    await runtime.tick()
    expect(runtime.state().phase).toBe('exploration')
    for (let index = 0; index < 129; index += 1) {
      const result = await runtime.command(viewer(owner.id), {
        commandId: `post-reset-move:${index}`,
        command: { type: 'move', direction: 'east' },
      })
      expect(result.result.ok).toBe(true)
    }
    expect(runtime.state().fixtures[door.id]?.state).toBe('locked')
    expect(runtime.state().players[owner.id]?.inventory).toHaveLength(0)
    await runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'owner-c',
    })
    if (!resumed.ok) throw new Error('party did not resume')
    const before = resumed.runtime.sequence()
    expect(await resumed.runtime.command(viewer(owner.id), unlock)).toMatchObject({
      result: { ok: true },
      replayed: true,
    })
    expect(resumed.runtime.sequence()).toBe(before)
    const conflict = await resumed.runtime.command(viewer(owner.id), {
      ...unlock,
      command: { type: 'interact', targetId: 'fixture:boss-gate' },
    })
    expect(conflict.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(resumed.runtime.sequence()).toBe(before)
    await resumed.runtime.dispose()
  })

  it('reopens active parties from the persistent directory at boot', async () => {
    const repository = createMemoryPartyRepository()
    const first = createPartyRegistry({
      store: repository.store,
      directory: repository.directory,
      ownerId: 'registry-a',
    })
    const seeded = await first.seed({ partyId: 'party-one', seed: 42, players: roster })
    expect(seeded.ok).toBe(true)
    await first.stop()

    const second = createPartyRegistry({
      store: repository.store,
      directory: repository.directory,
      ownerId: 'registry-b',
    })
    const recovered = await second.start()
    expect(recovered).toHaveLength(1)
    expect(second.cached('party-one')?.state().partyId).toBe('party-one')
    await second.stop()
  })

  it('single-flights concurrent party seeds through the durable host registry', async () => {
    const repository = createMemoryPartyRepository()
    const registry = createPartyRegistry({
      store: repository.store,
      directory: repository.directory,
      ownerId: 'registry-single-flight',
    })
    const input = { partyId: 'party-one', seed: 42, players: roster }
    const [first, second] = await Promise.all([registry.seed(input), registry.seed(input)])
    if (!first.ok || !second.ok) throw new Error('party seed did not open')
    expect(first.runtime).toBe(second.runtime)
    expect(registry.listCached()).toEqual([first.runtime])
    expect(await repository.directory.list()).toEqual([
      { partyId: 'party-one', runKey: 'party:party-one' },
    ])
    await registry.stop()
  })
})
