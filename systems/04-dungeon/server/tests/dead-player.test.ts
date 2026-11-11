import type { Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import {
  applyAuthenticatedPlayerCommand,
  applyPresence,
  createInitialWorld,
  createMemoryPartyRepository,
  createPartyRuntime,
  type PlayerCommand,
  simulateTick,
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

const exploring = (): WorldState => {
  let state = createInitialWorld('party-one', 42, roster)
  state = applyPresence(state, 'player-one', true)
  state = applyPresence(state, 'player-two', true)
  for (const playerId of ['player-one', 'player-two']) {
    state = applyAuthenticatedPlayerCommand(state, playerId, {
      type: 'ready',
      ready: true,
    }).state
  }
  return simulateTick(simulateTick(state))
}

const defeatedFailure = {
  ok: false,
  code: 'INVALID_COMMAND',
  message: 'defeated players can only request a rematch',
}

describe('defeated player command rejection', () => {
  it('rejects every non-rematch command without mutating simulation state', () => {
    const state = exploring()
    const player = state.players['player-one']
    const enemy = state.enemies['enemy:crawler:1']
    if (player === undefined || enemy === undefined) throw new Error('combat fixtures missing')
    player.health = 0
    player.x = enemy.x
    player.y = enemy.y
    const commands = [
      { type: 'ready', ready: false },
      { type: 'move', direction: 'west' },
      { type: 'attack', targetId: enemy.id },
      { type: 'interact', targetId: 'fixture:shared-door' },
      { type: 'pickup', lootId: 'loot:bound-key' },
      { type: 'item-use', slot: 0 },
    ] satisfies readonly PlayerCommand[]

    for (const command of commands) {
      const rejected = applyAuthenticatedPlayerCommand(state, player.id, command)
      expect(rejected.result).toEqual(defeatedFailure)
      expect(rejected.state).toBe(state)
    }
    expect(state.players[player.id]).toMatchObject({ facing: 'east', move: { x: 0, y: 0 } })
    expect(state.enemies[enemy.id]?.health).toBe(enemy.maxHealth)

    state.phase = 'defeat'
    expect(applyAuthenticatedPlayerCommand(state, player.id, { type: 'rematch' }).result).toEqual({
      ok: true,
    })
  })

  it('preflights dead movement and attacks before durable sequence advances', async () => {
    const repository = createMemoryPartyRepository()
    const opened = await createPartyRuntime({
      partyId: 'party-one',
      store: repository.store,
      ownerId: 'dead-player-test',
      seed: 42,
      players: roster,
    })
    if (!opened.ok) throw new Error('party did not open')
    const runtime = opened.runtime
    await runtime.connect('player-one')
    await runtime.connect('player-two')
    for (const playerId of ['player-one', 'player-two']) {
      await runtime.command(viewer(playerId), {
        commandId: `ready:${playerId}`,
        command: { type: 'ready', ready: true },
      })
    }
    await runtime.tick()
    await runtime.tick()
    const player = runtime.state().players['player-one']
    const enemy = runtime.state().enemies['enemy:crawler:1']
    if (player === undefined || enemy === undefined) throw new Error('combat fixtures missing')
    player.health = 0
    player.x = enemy.x
    player.y = enemy.y
    const before = runtime.sequence()
    const enemyHealth = enemy.health

    const ready = await runtime.command(viewer(player.id), {
      commandId: 'dead-ready',
      command: { type: 'ready', ready: false },
    })
    expect(ready.result).toEqual(defeatedFailure)
    expect(runtime.sequence()).toBe(before)
    const move = await runtime.command(viewer(player.id), {
      commandId: 'dead-move',
      command: { type: 'move', direction: 'west' },
    })
    expect(move.result).toEqual(defeatedFailure)
    expect(runtime.sequence()).toBe(before)
    const attack = await runtime.command(viewer(player.id), {
      commandId: 'dead-attack',
      command: { type: 'attack', targetId: enemy.id },
    })
    expect(attack.result).toEqual(defeatedFailure)
    expect(runtime.sequence()).toBe(before)
    expect(runtime.state().players[player.id]).toMatchObject({
      facing: 'east',
      move: { x: 0, y: 0 },
    })
    expect(runtime.state().enemies[enemy.id]?.health).toBe(enemyHealth)
    await runtime.dispose()
  })
})
