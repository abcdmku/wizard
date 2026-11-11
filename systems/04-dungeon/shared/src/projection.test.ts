import { describe, expect, it } from 'vitest'
import { canPlayerOpenDoor, canUseBoundKey } from './entities.js'
import {
  isServerFrameWithinLimit,
  MAX_SERVER_FRAME_BYTES,
  ServerFrameSchema,
  type SnapshotFrame,
} from './frames.js'
import {
  door,
  fixtureNow,
  owner,
  ownerKey,
  projectionState,
  teammate,
  teammateViewer,
  viewer,
} from './projection.fixture.js'
import {
  ParsedDungeonState,
  PlayerProjectionSchema,
  projectDungeonForViewer,
  projectParsedDungeonForViewer,
} from './projection.js'

const requireProjection = (state: ParsedDungeonState) => {
  const projection = projectParsedDungeonForViewer(state, viewer)
  if (projection === undefined) throw new Error('viewer should have a projection')
  return projection
}

describe('private player projection', () => {
  it('matches the validated projection for every member', () => {
    const parsedState = ParsedDungeonState.parse(projectionState)
    for (const memberViewer of [viewer, teammateViewer]) {
      const canonical = projectDungeonForViewer(projectionState, memberViewer)
      const fast = projectParsedDungeonForViewer(parsedState, memberViewer)
      expect(fast).toEqual(canonical)
      expect(PlayerProjectionSchema.safeParse(fast).success).toBe(true)
    }
  })

  it('shows owner data and removes teammate and fixture secrets', () => {
    const canonical = projectDungeonForViewer(projectionState, viewer)
    const fast = requireProjection(ParsedDungeonState.parse(projectionState))
    if (canonical === undefined) throw new Error('viewer should have a canonical projection')

    expect(fast).toEqual(canonical)
    expect(fast.self.inventory.items).toEqual([ownerKey])
    expect(fast.self.effects[0]?.name).toBe('shield')
    expect(fast.teammates[0]?.publicItemCount).toBe(1)
    const serialized = JSON.stringify(fast)
    expect(serialized).not.toContain(viewer.sessionId)
    expect(serialized).not.toContain('teammate-secret-item')
    expect(serialized).not.toContain('teammate-secret-effect')
    expect(JSON.stringify(fast.teammates)).not.toContain('remainingTicks')
    expect(fast.visibleLoot[0]).not.toHaveProperty('boundToPlayerId')
    expect(fast.fixtures[0]).not.toHaveProperty('requiredKeyId')
  })

  it('keeps parsed state and other projections isolated from caller mutation', () => {
    const parsedState = ParsedDungeonState.parse({
      ...projectionState,
      projectiles: [
        {
          kind: 'projectile',
          id: 'projectile-1',
          ownerId: 'player-1',
          position: { x: 128, y: 64 },
          direction: 'east',
          damage: 2,
          expiresAtTick: 14,
        },
      ],
    })
    const changed = requireProjection(parsedState)
    const untouched = requireProjection(parsedState)
    if (changed.map === null) throw new Error('map missing')
    const item = changed.self.inventory.items[0]
    const effect = changed.self.effects[0]
    const teammateState = changed.teammates[0]
    const enemy = changed.enemies[0]
    const loot = changed.visibleLoot[0]
    const fixture = changed.fixtures[0]
    const projectile = changed.projectiles[0]
    if (
      item === undefined ||
      effect === undefined ||
      teammateState === undefined ||
      enemy === undefined ||
      loot === undefined ||
      fixture === undefined ||
      projectile === undefined
    ) {
      throw new Error('projection isolation fixture is incomplete')
    }
    const baseline = JSON.stringify(untouched)

    changed.map.rows[0] = '..'
    changed.map.spawnPoints[0] = { x: 9, y: 9 }
    changed.self.position.x = 999
    item.id = 'changed-item'
    effect.remainingTicks = 1
    teammateState.position.x = 999
    enemy.position.x = 999
    loot.position.x = 999
    fixture.position.x = 999
    projectile.position.x = 999
    changed.objective.progress = 99

    expect(JSON.stringify(untouched)).toBe(baseline)
    expect(JSON.stringify(requireProjection(parsedState))).toBe(baseline)
  })

  it('rejects plain and prototype-forged parsed states at runtime', () => {
    expect(() =>
      Reflect.apply(projectParsedDungeonForViewer, undefined, [projectionState, viewer]),
    ).toThrow(TypeError)
    const forged = Object.create(ParsedDungeonState.prototype)
    expect(() => Reflect.apply(projectParsedDungeonForViewer, undefined, [forged, viewer])).toThrow(
      TypeError,
    )
  })

  it('ignores an own method override on a genuine parsed state', () => {
    const parsedState = ParsedDungeonState.parse(projectionState)
    const expected = requireProjection(parsedState)
    Object.assign(parsedState, { project: () => undefined })
    expect(projectParsedDungeonForViewer(parsedState, viewer)).toEqual(expected)
  })

  it('refuses teammate DTOs with private inventory or effects', () => {
    const projection = projectDungeonForViewer(projectionState, viewer)
    if (projection === undefined) throw new Error('viewer should have a projection')
    const publicPlayer = projection.teammates[0]
    expect(
      PlayerProjectionSchema.safeParse({
        ...projection,
        teammates: [{ ...publicPlayer, inventory: teammate.inventory }],
      }).success,
    ).toBe(false)
  })
})

describe('player-bound key and shared door', () => {
  it('permits only the nearby owner to use the key', () => {
    expect(canUseBoundKey(owner.id, ownerKey)).toBe(true)
    expect(canUseBoundKey(teammate.id, ownerKey)).toBe(false)
    expect(canPlayerOpenDoor(owner, door, 64)).toBe(true)
    expect(canPlayerOpenDoor(teammate, door, 64)).toBe(false)
    expect(canPlayerOpenDoor({ ...owner, position: { x: 1_000, y: 1_000 } }, door, 64)).toBe(false)
  })
})

describe('projected server frames', () => {
  it('parses correlated snapshots without serializing viewer scope', () => {
    const projection = projectDungeonForViewer(projectionState, viewer)
    if (projection === undefined) throw new Error('viewer should have a projection')
    const frame: SnapshotFrame = {
      type: 'snapshot',
      protocolVersion: 1,
      partyId: 'party-1',
      instanceId: 'instance-1',
      epoch: 1,
      sequence: 7,
      tick: 12,
      sentAt: fixtureNow,
      projection,
    }
    expect(ServerFrameSchema.safeParse(frame).success).toBe(true)
    expect(JSON.stringify(frame)).not.toContain('session-1')
    expect(isServerFrameWithinLimit(frame)).toBe(true)
    expect(MAX_SERVER_FRAME_BYTES).toBe(25_000)
  })
})
