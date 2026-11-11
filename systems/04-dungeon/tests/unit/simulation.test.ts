import {
  applyAuthenticatedPlayerCommand,
  applyPresence,
  createInitialWorld,
  projectState,
  simulateTick,
  type WorldState,
} from '@wizard/dungeon-server'
import { describe, expect, it } from 'vitest'

const OWNER_ID = 'player:key-owner'
const TEAMMATE_ID = 'player:teammate'
const TENANT_SENTINEL = 'tenant-private-sentinel'
const ROSTER = [
  { id: OWNER_ID, name: 'Key owner' },
  { id: TEAMMATE_ID, name: 'Teammate' },
] as const

function player(state: WorldState, playerId: string) {
  const value = state.players[playerId]
  if (value === undefined) throw new Error(`missing player ${playerId}`)
  return value
}

function viewer(playerId: string) {
  return {
    tenantId: TENANT_SENTINEL,
    partyId: 'party-test',
    playerId,
    sessionId: `session-private-${playerId}`,
  } as const
}

function fixture(state: WorldState, fixtureId: string) {
  const value = state.fixtures[fixtureId]
  if (value === undefined) throw new Error(`missing fixture ${fixtureId}`)
  return value
}

function loot(state: WorldState, lootId: string) {
  const value = state.loot[lootId]
  if (value === undefined) throw new Error(`missing loot ${lootId}`)
  return value
}

function enemy(state: WorldState, enemyId: string) {
  const value = state.enemies[enemyId]
  if (value === undefined) throw new Error(`missing enemy ${enemyId}`)
  return value
}

function activeWorld(seed = 73): WorldState {
  let state = createInitialWorld('party-test', seed, ROSTER)
  state = applyPresence(state, OWNER_ID, true)
  state = applyPresence(state, TEAMMATE_ID, true)
  state = simulateTick(state)
  state = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
    type: 'ready',
    ready: true,
  }).state
  state = applyAuthenticatedPlayerCommand(state, TEAMMATE_ID, {
    type: 'ready',
    ready: true,
  }).state
  state = simulateTick(state)
  state = simulateTick(state)
  if (state.phase !== 'exploration') throw new Error(`unexpected phase ${state.phase}`)
  return state
}

function placePlayer(state: WorldState, playerId: string, x: number, y: number): WorldState {
  const next = structuredClone(state)
  const target = player(next, playerId)
  target.x = x
  target.y = y
  target.move = { x: 0, y: 0 }
  return next
}

describe('dungeon simulation', () => {
  it('replays the same seed and authenticated commands byte-for-byte', () => {
    const run = (): WorldState => {
      let state = activeWorld(5_081)
      state = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
        type: 'move',
        direction: 'east',
      }).state
      state = simulateTick(simulateTick(simulateTick(state)))
      return state
    }

    const first = run()
    const second = run()
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(player(first, OWNER_ID).x).toBe(272)
    expect(first.tick).toBe(6)
  })

  it('lets only the key owner unlock the shared door and redacts the key for teammates', () => {
    let state = activeWorld()
    const boundKey = loot(state, 'loot:bound-key')
    state = placePlayer(state, OWNER_ID, boundKey.x, boundKey.y)
    const pickup = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
      type: 'pickup',
      lootId: boundKey.id,
    })
    expect(pickup.result).toEqual({ ok: true })
    state = pickup.state

    const privateKey = player(state, OWNER_ID).inventory.find((item) => item.kind === 'bound-key')
    expect(privateKey).toMatchObject({ boundToPlayerId: OWNER_ID })
    if (privateKey === undefined) throw new Error('owner did not receive the bound key')
    player(state, OWNER_ID).effects.push({
      id: 'private-effect-cinder-lease',
      kind: 'shield',
      remainingTicks: 9_876,
    })
    const ownerBeforeOpen = JSON.stringify(projectState(state, viewer(OWNER_ID)))
    const teammateBeforeOpen = JSON.stringify(projectState(state, viewer(TEAMMATE_ID)))
    expect(ownerBeforeOpen).toContain(privateKey.id)
    expect(teammateBeforeOpen).not.toContain(privateKey.id)
    expect(teammateBeforeOpen).not.toContain(privateKey.label)
    expect(teammateBeforeOpen).not.toContain('boundToPlayerId')
    expect(teammateBeforeOpen).not.toContain('private-effect-cinder-lease')
    expect(teammateBeforeOpen).not.toContain('remainingTicks')
    expect(teammateBeforeOpen).not.toContain('9876')
    expect(teammateBeforeOpen).not.toContain(TENANT_SENTINEL)
    expect(teammateBeforeOpen).not.toContain(`session-private-${TEAMMATE_ID}`)

    const door = fixture(state, 'fixture:shared-door')
    state = placePlayer(state, OWNER_ID, door.x - 100, door.y)
    state = placePlayer(state, TEAMMATE_ID, door.x - 100, door.y)
    const denied = applyAuthenticatedPlayerCommand(state, TEAMMATE_ID, {
      type: 'interact',
      targetId: door.id,
    })
    expect(denied.result).toMatchObject({ ok: false, code: 'KEY_NOT_OWNED' })
    expect(fixture(denied.state, door.id).state).toBe('locked')

    const opened = applyAuthenticatedPlayerCommand(denied.state, OWNER_ID, {
      type: 'interact',
      targetId: door.id,
    })
    expect(opened.result).toEqual({ ok: true })
    expect(fixture(opened.state, door.id).state).toBe('open')
    expect(opened.state.objective.sharedDoorOpen).toBe(true)
    expect(player(opened.state, OWNER_ID).inventory).not.toContainEqual(privateKey)

    const publicDoor = { id: door.id, kind: 'shared-door', state: 'open' }
    const ownerProjection = projectState(opened.state, viewer(OWNER_ID))
    const teammateProjection = projectState(opened.state, viewer(TEAMMATE_ID))
    expect(ownerProjection.fixtures).toContainEqual(expect.objectContaining(publicDoor))
    expect(teammateProjection.fixtures).toContainEqual(expect.objectContaining(publicDoor))
    expect(JSON.stringify(ownerProjection.fixtures)).toContain(door.id)
    expect(JSON.stringify(teammateProjection.fixtures)).toContain(door.id)
  })

  it('opens the boss gate, completes combat, and starts a fresh deterministic rematch', () => {
    let state = activeWorld(912)
    state = structuredClone(state)
    state.objective.sharedDoorOpen = true
    const sharedDoor = fixture(state, 'fixture:shared-door')
    sharedDoor.state = 'open'

    const warden = enemy(state, 'enemy:warden:1')
    state = placePlayer(state, OWNER_ID, warden.x - 100, warden.y)
    enemy(state, warden.id).health = 35
    state = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
      type: 'attack',
      targetId: warden.id,
    }).state
    const sigil = loot(state, `loot:sigil:${warden.id}`)
    state = placePlayer(state, OWNER_ID, sigil.x, sigil.y)
    state = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
      type: 'pickup',
      lootId: sigil.id,
    }).state

    const gate = fixture(state, 'fixture:boss-gate')
    state = placePlayer(state, OWNER_ID, gate.x - 100, gate.y)
    state = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
      type: 'interact',
      targetId: gate.id,
    }).state
    expect(state.phase).toBe('boss')
    expect(enemy(state, 'enemy:boss').active).toBe(true)

    const boss = enemy(state, 'enemy:boss')
    state = placePlayer(state, OWNER_ID, boss.x - 100, boss.y)
    enemy(state, boss.id).health = 35
    player(state, OWNER_ID).attackCooldownTicks = 0
    state = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
      type: 'attack',
      targetId: boss.id,
    }).state
    expect(state.phase).toBe('victory')

    state = applyAuthenticatedPlayerCommand(state, OWNER_ID, { type: 'rematch' }).state
    state = applyAuthenticatedPlayerCommand(state, TEAMMATE_ID, { type: 'rematch' }).state
    expect(state.phase).toBe('rematch')
    state = simulateTick(state)
    expect(state).toMatchObject({ phase: 'lobby', runId: 2, seed: 912 })
    expect(Object.values(state.players).every((candidate) => !candidate.ready)).toBe(true)
  })
})
