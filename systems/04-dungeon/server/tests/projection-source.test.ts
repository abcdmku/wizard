import type { Run } from '@openwizard/core'
import type { SnapshotFrame } from '@openwizard/core/mirror'
import {
  DungeonStateSchema,
  type PlayerProjection,
  PlayerProjectionSchema,
  type Viewer,
} from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialWorld,
  createPlayerSource,
  dungeonWizard,
  type PlayerSource,
} from '../src/index.js'

const PARTY_ID = 'projection-party'
const roster = [
  { id: 'player-one', name: 'Ada' },
  { id: 'player-two', name: 'Lin' },
  { id: 'player-three', name: 'Grace' },
  { id: 'player-four', name: 'Edsger' },
]

const viewer = (playerId: string): Viewer => ({
  tenantId: PARTY_ID,
  partyId: PARTY_ID,
  playerId,
  sessionId: `session:${playerId}`,
})

const sourceSeed = (run: Run<typeof dungeonWizard>) => {
  const state = run.getState()
  return { world: state.context.world, sequence: state.seq, epoch: state.epoch }
}

const runs: Run<typeof dungeonWizard>[] = []

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose()
  vi.restoreAllMocks()
})

const openRun = async (): Promise<Run<typeof dungeonWizard>> => {
  const run = dungeonWizard.create(
    {
      world: createInitialWorld(PARTY_ID, 42, roster),
      commandResults: {},
      commandOrder: [],
    },
    {
      instanceId: `party:${PARTY_ID}`,
    },
  )
  runs.push(run)
  const started = await run.start()
  if (!started.ok) throw new Error(`dungeon wizard did not start: ${started.code}`)
  await run.whenIdle()
  return run
}

const send = async (
  run: Run<typeof dungeonWizard>,
  event: Parameters<typeof run.send>[0],
  payload: unknown,
): Promise<void> => {
  const result = await run.send(event, payload)
  if (!result.ok) throw new Error(`dungeon event failed: ${result.code}`)
  await run.whenIdle()
}

describe('player projection source', () => {
  it('skips metadata commits and emits once for each world change', async () => {
    const run = await openRun()
    const source = createPlayerSource(run, viewer('player-one'), sourceSeed(run))
    const frames: SnapshotFrame<PlayerProjection>[] = []
    source.subscribe((frame) => frames.push(frame))
    const initial = frames[0]
    if (initial === undefined) throw new Error('initial projection frame missing')
    const initialWorld = run.getState().context.world
    const committedWorlds: unknown[] = []
    const unsubscribeRun = run.subscribe((state) => committedWorlds.push(state.context.world))

    await send(run, 'player.command', {
      commandId: 'foreign-player-result',
      playerId: 'not-a-member',
      command: { type: 'ready', ready: true },
    })
    expect(committedWorlds).toContain(initialWorld)
    expect(run.getState().seq).toBeGreaterThan(initial.seq)
    expect(frames).toHaveLength(1)

    const expectOneFrame = async (
      work: () => Promise<void>,
    ): Promise<SnapshotFrame<PlayerProjection>> => {
      const before = frames.length
      await work()
      expect(frames).toHaveLength(before + 1)
      const frame = frames.at(-1)
      if (frame === undefined) throw new Error('world update frame missing')
      expect(frame.state.sequence).toBe(frame.seq)
      expect(frame.epoch).toBe(run.epoch)
      return frame
    }

    const connectedOne = await expectOneFrame(() =>
      send(run, 'player.connected', { playerId: 'player-one' }),
    )
    expect(connectedOne.seq).toBeGreaterThan(initial.seq + 1)
    await expectOneFrame(() => send(run, 'player.connected', { playerId: 'player-two' }))
    await expectOneFrame(() =>
      send(run, 'player.command', {
        commandId: 'ready-one',
        playerId: 'player-one',
        command: { type: 'ready', ready: true },
      }),
    )
    const ready = await expectOneFrame(() =>
      send(run, 'player.command', {
        commandId: 'ready-two',
        playerId: 'player-two',
        command: { type: 'ready', ready: true },
      }),
    )
    expect(ready.state.phase).toBe('lobby')
    await expectOneFrame(() => send(run, 'player.connected', { playerId: 'player-three' }))
    await expectOneFrame(() => send(run, 'player.connected', { playerId: 'player-four' }))
    await expectOneFrame(() =>
      send(run, 'player.command', {
        commandId: 'ready-three',
        playerId: 'player-three',
        command: { type: 'ready', ready: true },
      }),
    )
    const phaseChanged = await expectOneFrame(() =>
      send(run, 'player.command', {
        commandId: 'ready-four',
        playerId: 'player-four',
        command: { type: 'ready', ready: true },
      }),
    )
    expect(phaseChanged.state.phase).toBe('ready')
    const ticked = await expectOneFrame(() => send(run, 'world.tick', {}))
    expect(ticked.state.tick).toBe(1)
    const reset = await expectOneFrame(() => send(run, 'admin.reset', { seed: 84 }))
    expect(reset.state.phase).toBe('lobby')

    unsubscribeRun()
    source.dispose()
    const frameCount = frames.length
    await send(run, 'player.connected', { playerId: 'player-one' })
    expect(frames).toHaveLength(frameCount)
    expect(() => source.subscribe(() => undefined)).toThrow('player source is disposed')
  })

  it('converts a world once across four private viewer projections', async () => {
    const run = await openRun()
    const player = run.getState().context.world.players['player-one']
    if (player === undefined) throw new Error('projection owner missing')
    player.inventory.push({
      id: 'private-bound-key',
      kind: 'bound-key',
      label: 'Bound key',
      details: 'Only the owner can use this key.',
      quantity: 1,
      slot: 0,
      boundToPlayerId: player.id,
    })
    const parse = vi.spyOn(DungeonStateSchema, 'parse')
    const projectionParse = vi.spyOn(PlayerProjectionSchema, 'parse')
    const sources: PlayerSource[] = []
    const frames = new Map<string, SnapshotFrame<PlayerProjection>[]>()

    for (const member of roster) {
      const memberFrames: SnapshotFrame<PlayerProjection>[] = []
      frames.set(member.id, memberFrames)
      const source = createPlayerSource(run, viewer(member.id), sourceSeed(run))
      sources.push(source)
      source.subscribe((frame) => memberFrames.push(frame))
    }

    expect(parse).toHaveBeenCalledTimes(1)
    expect(projectionParse).not.toHaveBeenCalled()
    const owner = frames.get('player-one')?.[0]?.state
    const teammate = frames.get('player-two')?.[0]?.state
    if (owner === undefined || teammate === undefined) throw new Error('viewer frame missing')
    expect(owner.self.inventory.items).toContainEqual(
      expect.objectContaining({ id: 'private-bound-key', boundToPlayerId: 'player-one' }),
    )
    expect(teammate.self.id).toBe('player-two')
    expect(teammate.teammates).toContainEqual(
      expect.objectContaining({ id: 'player-one', publicItemCount: 1 }),
    )
    expect(JSON.stringify(teammate)).not.toContain('private-bound-key')
    expect(JSON.stringify(teammate)).not.toContain('boundToPlayerId')

    await send(run, 'player.connected', { playerId: 'player-one' })
    expect(parse).toHaveBeenCalledTimes(2)
    expect(projectionParse).not.toHaveBeenCalled()
    for (const memberFrames of frames.values()) expect(memberFrames).toHaveLength(2)
    for (const source of sources) source.dispose()
  })
})
