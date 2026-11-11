import { INTERACTION_RANGE_TILES, type Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import {
  applyAuthenticatedPlayerCommand,
  applyPresence,
  authorizePlayerCommand,
  createInitialWorld,
  INTERACTION_RANGE_UNITS,
  projectState,
  simulateTick,
  UNITS_PER_TILE,
  type WorldState,
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

const connectedLobby = (): WorldState => {
  let state = createInitialWorld('party-one', 42, roster)
  state = applyPresence(state, 'player-one', true)
  state = applyPresence(state, 'player-two', true)
  return state
}

const exploring = (): WorldState => {
  let state = connectedLobby()
  state = applyAuthenticatedPlayerCommand(state, 'player-one', {
    type: 'ready',
    ready: true,
  }).state
  state = applyAuthenticatedPlayerCommand(state, 'player-two', {
    type: 'ready',
    ready: true,
  }).state
  state = simulateTick(state)
  return simulateTick(state)
}

const exploringWithBoundKey = (): WorldState => {
  const state = exploring()
  const player = state.players['player-one']
  const key = state.loot['loot:bound-key']
  if (player === undefined || key === undefined) throw new Error('bound key fixture missing')
  player.x = key.x
  player.y = key.y
  const pickup = applyAuthenticatedPlayerCommand(state, player.id, {
    type: 'pickup',
    lootId: key.id,
  })
  if (!pickup.result.ok) throw new Error(`bound key pickup failed: ${pickup.result.code}`)
  return pickup.state
}

describe('deterministic dungeon simulation', () => {
  it('generates the same dungeon for the same seed and requires the whole roster', () => {
    let first = connectedLobby()
    first = applyAuthenticatedPlayerCommand(first, 'player-one', {
      type: 'ready',
      ready: true,
    }).state
    expect(first.phase).toBe('lobby')
    first = applyAuthenticatedPlayerCommand(first, 'player-two', {
      type: 'ready',
      ready: true,
    }).state
    expect(first.phase).toBe('ready')
    expect(simulateTick(first).phase).toBe('generated')
    expect(exploring()).toEqual(exploring())
  })

  it('consumes movement as a one-tick intent', () => {
    let state = exploring()
    const before = state.players['player-one']?.x
    expect(before).toBeTypeOf('number')
    state = applyAuthenticatedPlayerCommand(state, 'player-one', {
      type: 'move',
      direction: 'east',
    }).state
    state = simulateTick(state)
    const moved = state.players['player-one']?.x
    expect(moved).toBeGreaterThan(before ?? 0)
    state = simulateTick(state)
    expect(state.players['player-one']?.x).toBe(moved)
  })

  it('uses the shared exact interaction boundary for pickup and fixtures', () => {
    expect(INTERACTION_RANGE_UNITS).toBe(INTERACTION_RANGE_TILES * UNITS_PER_TILE)

    let pickupState = exploring()
    const pickupPlayer = pickupState.players['player-one']
    const potion = pickupState.loot['loot:potion:1']
    if (pickupPlayer === undefined || potion === undefined)
      throw new Error('pickup fixture missing')
    pickupPlayer.x = potion.x - INTERACTION_RANGE_UNITS
    pickupPlayer.y = potion.y
    const pickupAtBoundary = applyAuthenticatedPlayerCommand(pickupState, pickupPlayer.id, {
      type: 'pickup',
      lootId: potion.id,
    })
    expect(pickupAtBoundary.result).toEqual({ ok: true })

    pickupState = exploring()
    const outsidePlayer = pickupState.players['player-one']
    const outsidePotion = pickupState.loot['loot:potion:1']
    if (outsidePlayer === undefined || outsidePotion === undefined) {
      throw new Error('outside pickup fixture missing')
    }
    outsidePlayer.x = outsidePotion.x - (INTERACTION_RANGE_UNITS + 0.01)
    outsidePlayer.y = outsidePotion.y
    expect(
      applyAuthenticatedPlayerCommand(pickupState, outsidePlayer.id, {
        type: 'pickup',
        lootId: outsidePotion.id,
      }).result,
    ).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' })

    let doorState = exploringWithBoundKey()
    const owner = doorState.players['player-one']
    const door = doorState.fixtures['fixture:shared-door']
    if (owner === undefined || door === undefined) throw new Error('door fixture missing')
    owner.x = door.x - INTERACTION_RANGE_UNITS
    owner.y = door.y
    const doorAtBoundary = applyAuthenticatedPlayerCommand(doorState, owner.id, {
      type: 'interact',
      targetId: door.id,
    })
    expect(doorAtBoundary.result).toEqual({ ok: true })
    expect(doorAtBoundary.state.fixtures[door.id]?.state).toBe('open')

    doorState = exploringWithBoundKey()
    const outsideOwner = doorState.players['player-one']
    const outsideDoor = doorState.fixtures['fixture:shared-door']
    if (outsideOwner === undefined || outsideDoor === undefined) {
      throw new Error('outside door fixture missing')
    }
    outsideOwner.x = outsideDoor.x - (INTERACTION_RANGE_UNITS + 0.01)
    outsideOwner.y = outsideDoor.y
    expect(
      applyAuthenticatedPlayerCommand(doorState, outsideOwner.id, {
        type: 'interact',
        targetId: outsideDoor.id,
      }).result,
    ).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' })
  })

  it('keeps a bound key private and lets only its authenticated owner open the shared door', () => {
    let state = exploring()
    const owner = state.players['player-one']
    const teammate = state.players['player-two']
    const key = state.loot['loot:bound-key']
    const door = state.fixtures['fixture:shared-door']
    expect(owner).toBeDefined()
    expect(teammate).toBeDefined()
    expect(key).toBeDefined()
    expect(door).toBeDefined()
    if (owner === undefined || teammate === undefined || key === undefined || door === undefined) {
      throw new Error('fixture setup failed')
    }
    owner.x = key.x
    owner.y = key.y
    state = applyAuthenticatedPlayerCommand(state, owner.id, {
      type: 'pickup',
      lootId: key.id,
    }).state

    const ownerProjection = projectState(state, viewer(owner.id))
    const teammateProjection = projectState(state, viewer(teammate.id))
    expect(ownerProjection.self.inventory.items[0]).toMatchObject({
      kind: 'player-bound-key',
      boundToPlayerId: owner.id,
    })
    expect(teammateProjection.teammates[0]).toMatchObject({ publicItemCount: 1 })
    expect(JSON.stringify(teammateProjection)).not.toContain('boundToPlayerId')
    expect(JSON.stringify(teammateProjection)).not.toContain('key:shared-door')

    const currentOwner = state.players[owner.id]
    const currentTeammate = state.players[teammate.id]
    const currentDoor = state.fixtures[door.id]
    if (currentOwner === undefined || currentTeammate === undefined || currentDoor === undefined) {
      throw new Error('post-pickup fixture setup failed')
    }
    currentTeammate.x = currentDoor.x
    currentTeammate.y = currentDoor.y
    expect(
      authorizePlayerCommand(state, currentTeammate.id, {
        type: 'interact',
        targetId: currentDoor.id,
      }),
    ).toMatchObject({ ok: false, code: 'KEY_NOT_OWNED' })
    currentOwner.x = currentDoor.x
    currentOwner.y = currentDoor.y
    state = applyAuthenticatedPlayerCommand(state, currentOwner.id, {
      type: 'interact',
      targetId: currentDoor.id,
    }).state
    expect(state.fixtures[currentDoor.id]?.state).toBe('open')
    expect(projectState(state, viewer(teammate.id)).fixtures).toContainEqual(
      expect.objectContaining({ id: currentDoor.id, state: 'open' }),
    )
  })

  it('creates a real private haste effect from a consumable', () => {
    let state = exploring()
    const player = state.players['player-one']
    const tonic = state.loot['loot:bomb:1']
    if (player === undefined || tonic === undefined) throw new Error('tonic fixture missing')
    player.x = tonic.x
    player.y = tonic.y
    state = applyAuthenticatedPlayerCommand(state, player.id, {
      type: 'pickup',
      lootId: tonic.id,
    }).state
    const slot = state.players[player.id]?.inventory[0]?.slot
    expect(slot).toBeTypeOf('number')
    if (slot === undefined) throw new Error('tonic slot missing')
    state = applyAuthenticatedPlayerCommand(state, player.id, { type: 'item-use', slot }).state
    expect(state.players[player.id]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'haste' }),
    )
  })

  it('holds disconnect until the roster returns, then restores the active phase', () => {
    let state = exploring()
    state = applyPresence(state, 'player-one', false)
    expect(state.phase).toBe('disconnect')
    expect(simulateTick(state).phase).toBe('disconnect')
    state = applyPresence(state, 'player-one', true)
    expect(state.phase).toBe('reconnect')
    expect(simulateTick(state).phase).toBe('exploration')
  })

  it('supports boss victory and unanimous rematch', () => {
    let state = exploring()
    const boss = state.enemies['enemy:boss']
    const player = state.players['player-one']
    if (boss === undefined || player === undefined) throw new Error('boss fixture missing')
    state.phase = 'boss'
    boss.active = true
    boss.health = 30
    player.x = boss.x
    player.y = boss.y
    state = applyAuthenticatedPlayerCommand(state, player.id, {
      type: 'attack',
      targetId: boss.id,
    }).state
    expect(state.phase).toBe('victory')
    state = applyAuthenticatedPlayerCommand(state, 'player-one', { type: 'rematch' }).state
    state = applyAuthenticatedPlayerCommand(state, 'player-two', { type: 'rematch' }).state
    expect(state.phase).toBe('rematch')
    const rematch = simulateTick(state)
    expect(rematch.phase).toBe('lobby')
    expect(rematch.runId).toBe(2)
  })
})
