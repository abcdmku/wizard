import {
  applyAuthenticatedPlayerCommand,
  applyPresence,
  createInitialWorld,
  type Facing,
  simulateTick,
  UNITS_PER_TILE,
  type WorldState,
} from '@wizard/dungeon-server'
import { describe, expect, it } from 'vitest'

// The browser journey seeds its party with 1 and fights the boss from the cover described in
// tests/e2e/dungeon-route.ts. This replays that route against the simulation, so a change to
// the map, the ranges or the way enemies walk fails here and not in the browser.
const JOURNEY_SEED = 1
const OWNER_ID = 'e2e-player-0'
const TEAMMATE_ID = 'e2e-player-1'
const BOSS_ID = 'enemy:boss'
const GATE_ID = 'fixture:boss-gate'
const COVER = { leaveGateY: 7.12, approachX: 16.1, wallX: 16.64, y: 3.05 } as const

const units = (tiles: number): number => tiles * UNITS_PER_TILE

function player(state: WorldState, playerId: string) {
  const value = state.players[playerId]
  if (value === undefined) throw new Error(`missing player ${playerId}`)
  return value
}

function boss(state: WorldState) {
  const value = state.enemies[BOSS_ID]
  if (value === undefined) throw new Error('missing boss')
  return value
}

const step = (state: WorldState, playerId: string, direction: Facing): WorldState =>
  simulateTick(applyAuthenticatedPlayerCommand(state, playerId, { type: 'move', direction }).state)

/** Holds a direction until `arrived`, then for `late` more ticks, as a slow key release does. */
function walk(
  state: WorldState,
  playerId: string,
  direction: Facing,
  arrived: (position: { x: number; y: number }) => boolean,
  late = 0,
): WorldState {
  let next = state
  for (let tick = 0; tick < 200 && !arrived(player(next, playerId)); tick += 1) {
    next = step(next, playerId, direction)
  }
  expect(arrived(player(next, playerId))).toBe(true)
  for (let tick = 0; tick < late; tick += 1) next = step(next, playerId, direction)
  return next
}

function idle(state: WorldState, ticks: number): WorldState {
  let next = state
  for (let tick = 0; tick < ticks; tick += 1) next = simulateTick(next)
  return next
}

/**
 * The three moves of takeBossCover: reach the column, reach the row, lean on the pillar.
 * `waitInColumn` idles after the first move, where the journey may take any time.
 */
function takeCover(
  state: WorldState,
  playerId: string,
  late: number,
  waitInColumn = 0,
): WorldState {
  const start = player(state, playerId)
  let next = walk(
    state,
    playerId,
    start.x < units(COVER.approachX) ? 'east' : 'west',
    ({ x }) => Math.abs(x - units(COVER.approachX)) <= 45,
    late,
  )
  next = idle(next, waitInColumn)
  const inRow = ({ y }: { y: number }) => Math.abs(y - units(COVER.y)) <= 12.5
  next = walk(next, playerId, 'north', inRow, late)
  if (!inRow(player(next, playerId))) next = walk(next, playerId, 'south', inRow)
  return walk(next, playerId, 'east', ({ x }) => x >= units(COVER.wallX) - 10, 3)
}

/** The journey's world once both fighters stand on the door row with the gate still shut. */
function worldBeforeBoss(): WorldState {
  let state = createInitialWorld('party-test', JOURNEY_SEED, [
    { id: OWNER_ID, name: 'Key owner' },
    { id: TEAMMATE_ID, name: 'Teammate' },
  ])
  for (const id of [OWNER_ID, TEAMMATE_ID]) {
    state = applyPresence(state, id, true)
    state = applyAuthenticatedPlayerCommand(state, id, { type: 'ready', ready: true }).state
  }
  state = idle(state, 2)
  if (state.phase !== 'exploration') throw new Error(`unexpected phase ${state.phase}`)
  for (const enemy of Object.values(state.enemies)) if (enemy.id !== BOSS_ID) enemy.health = 0
  const door = state.fixtures['fixture:shared-door']
  if (door !== undefined) door.state = 'open'
  state.objective.sharedDoorOpen = true
  state.objective.collected = state.objective.required
  // Both walked here from their spawn points in whole steps of 22 units.
  Object.assign(player(state, OWNER_ID), { x: 250 + 22 * 68, y: 250 + 22 * 23 })
  Object.assign(player(state, TEAMMATE_ID), { x: 350 + 22 * 32, y: 250 + 22 * 23 })
  return state
}

function fightFromCover(options: {
  readonly reaction: number
  readonly pause: number
  readonly late: number
  readonly betweenRounds: number
}): WorldState {
  let state = takeCover(worldBeforeBoss(), TEAMMATE_ID, options.late)
  state = walk(state, OWNER_ID, 'south', ({ y }) => y >= 844, 3)
  const opened = applyAuthenticatedPlayerCommand(state, OWNER_ID, {
    type: 'interact',
    targetId: GATE_ID,
  })
  expect(opened.result).toEqual({ ok: true })
  state = idle(opened.state, options.reaction)
  // leaveBossGate, then the pause before takeBossCover starts.
  state = walk(state, OWNER_ID, 'north', ({ y }) => y <= units(COVER.leaveGateY) + 22, options.late)
  state = idle(state, options.pause)
  state = takeCover(state, OWNER_ID, options.late, options.betweenRounds)
  for (let round = 0; round < 4; round += 1) {
    state = idle(state, options.betweenRounds)
    for (const id of [OWNER_ID, TEAMMATE_ID]) {
      const attack = applyAuthenticatedPlayerCommand(state, id, {
        type: 'attack',
        targetId: BOSS_ID,
      })
      expect(attack.result).toEqual({ ok: true })
      state = attack.state
    }
  }
  return state
}

describe('boss cover used by the browser journey', () => {
  it.each([
    { reaction: 0, pause: 2, late: 0, betweenRounds: 60 },
    { reaction: 5, pause: 8, late: 1, betweenRounds: 60 },
    { reaction: 5, pause: 8, late: 1, betweenRounds: 600 },
  ])(
    'wins without damage with reaction $reaction, pause $pause, late $late and $betweenRounds ticks a round',
    (options) => {
      const state = fightFromCover(options)
      expect(state.phase).toBe('victory')
      expect(boss(state).health).toBe(0)
      expect(player(state, OWNER_ID).health).toBe(100)
      expect(player(state, TEAMMATE_ID).health).toBe(100)
    },
  )
})
