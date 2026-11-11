import {
  type EnemyState,
  type Facing,
  type PlayerState,
  sortedValues,
  UNITS_PER_TILE,
  type WorldPosition,
  type WorldState,
} from './domain.js'
import { createInitialWorld, generateDungeon } from './generate.js'

const PLAYER_SPEED = 22
const ENEMY_SPEED = 10
const COLLISION_RADIUS = 28

export const cloneWorld = (state: WorldState): WorldState => structuredClone(state)

export const distanceSquared = (left: WorldPosition, right: WorldPosition): number => {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

export const inRange = (left: WorldPosition, right: WorldPosition, range: number): boolean =>
  distanceSquared(left, right) <= range * range

export const setPhase = (state: WorldState, phase: WorldState['phase']): void => {
  if (state.phase === phase) return
  state.phase = phase
  state.phaseEnteredTick = state.tick
}

export const vectorForFacing = (facing: Facing): WorldPosition => {
  switch (facing) {
    case 'north':
      return { x: 0, y: -1 }
    case 'east':
      return { x: 1, y: 0 }
    case 'south':
      return { x: 0, y: 1 }
    case 'west':
      return { x: -1, y: 0 }
  }
}

const isSolid = (state: WorldState, x: number, y: number): boolean => {
  const tileX = Math.floor(x / UNITS_PER_TILE)
  const tileY = Math.floor(y / UNITS_PER_TILE)
  const row = state.map.rows[tileY]
  if (row === undefined || row[tileX] === undefined || row[tileX] === '#') return true
  return sortedValues(state.fixtures).some(
    (fixture) =>
      fixture.state !== 'open' &&
      Math.floor(fixture.x / UNITS_PER_TILE) === tileX &&
      Math.floor(fixture.y / UNITS_PER_TILE) === tileY,
  )
}

const canOccupy = (state: WorldState, point: WorldPosition): boolean =>
  !isSolid(state, point.x - COLLISION_RADIUS, point.y - COLLISION_RADIUS) &&
  !isSolid(state, point.x + COLLISION_RADIUS, point.y - COLLISION_RADIUS) &&
  !isSolid(state, point.x - COLLISION_RADIUS, point.y + COLLISION_RADIUS) &&
  !isSolid(state, point.x + COLLISION_RADIUS, point.y + COLLISION_RADIUS)

const moveActor = (
  state: WorldState,
  actor: WorldPosition,
  vector: WorldPosition,
  speed: number,
): void => {
  const horizontal = { x: actor.x + vector.x * speed, y: actor.y }
  if (canOccupy(state, horizontal)) actor.x = horizontal.x
  const vertical = { x: actor.x, y: actor.y + vector.y * speed }
  if (canOccupy(state, vertical)) actor.y = vertical.y
}

const livingPlayers = (state: WorldState): PlayerState[] =>
  sortedValues(state.players).filter((player) => player.health > 0)

const closestPlayer = (state: WorldState, enemy: EnemyState): PlayerState | undefined =>
  livingPlayers(state).sort((left, right) => {
    const delta = distanceSquared(left, enemy) - distanceSquared(right, enemy)
    return delta === 0 ? left.id.localeCompare(right.id) : delta
  })[0]

const directionToward = (from: WorldPosition, to: WorldPosition): WorldPosition => {
  const x = Math.sign(to.x - from.x)
  const y = Math.sign(to.y - from.y)
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) return { x, y: 0 }
  return { x: 0, y }
}

const facingToward = (from: WorldPosition, to: WorldPosition): Facing => {
  const vector = directionToward(from, to)
  if (vector.x > 0) return 'east'
  if (vector.x < 0) return 'west'
  return vector.y > 0 ? 'south' : 'north'
}

const tickPlayers = (state: WorldState): void => {
  for (const player of sortedValues(state.players)) {
    player.attackCooldownTicks = Math.max(0, player.attackCooldownTicks - 1)
    player.effects = player.effects
      .map((effect) => ({ ...effect, remainingTicks: effect.remainingTicks - 1 }))
      .filter((effect) => effect.remainingTicks > 0)
    if (player.health <= 0 || player.presence !== 'connected') continue
    const haste = player.effects.some((effect) => effect.kind === 'haste')
    moveActor(state, player, player.move, haste ? PLAYER_SPEED * 2 : PLAYER_SPEED)
    player.move = { x: 0, y: 0 }
  }
}

const enemyDamage = (enemy: EnemyState): number => {
  if (enemy.kind === 'boss') return enemy.health <= enemy.maxHealth / 2 ? 24 : 18
  if (enemy.kind === 'warden') return 14
  return enemy.kind === 'archer' ? 10 : 8
}

const tickEnemies = (state: WorldState): void => {
  for (const enemy of sortedValues(state.enemies)) {
    if (!enemy.active || enemy.health <= 0) continue
    enemy.attackCooldownTicks = Math.max(0, enemy.attackCooldownTicks - 1)
    const target = closestPlayer(state, enemy)
    if (target === undefined) continue
    enemy.facing = facingToward(enemy, target)
    if (!inRange(enemy, target, 115)) {
      moveActor(state, enemy, directionToward(enemy, target), ENEMY_SPEED)
      continue
    }
    if (enemy.attackCooldownTicks > 0) continue
    const shielded = target.effects.some((effect) => effect.kind === 'shield')
    const damage = shielded ? Math.ceil(enemyDamage(enemy) / 2) : enemyDamage(enemy)
    target.health = Math.max(0, target.health - damage)
    enemy.attackCooldownTicks = enemy.kind === 'boss' ? 8 : 12
    if (enemy.kind === 'boss') {
      const id = `projectile:${state.runId}:${state.tick}:${enemy.id}`
      state.projectiles[id] = {
        id,
        kind: 'arcane',
        x: enemy.x,
        y: enemy.y,
        angle: 0,
        ttlTicks: 5,
      }
    }
  }
}

const tickProjectiles = (state: WorldState): void => {
  for (const projectile of sortedValues(state.projectiles)) {
    projectile.ttlTicks -= 1
    if (projectile.ttlTicks <= 0) delete state.projectiles[projectile.id]
  }
}

const resetRematch = (state: WorldState): WorldState => {
  const roster = sortedValues(state.players).map((player) => ({ id: player.id, name: player.name }))
  const reset = createInitialWorld(state.partyId, state.seed, roster)
  reset.runId = state.runId + 1
  reset.tick = state.tick + 1
  for (const player of sortedValues(reset.players)) {
    const previous = state.players[player.id]
    if (previous === undefined) continue
    player.presence = previous.presence
    player.connectionEpoch = previous.connectionEpoch
  }
  return reset
}

const advanceLifecycle = (state: WorldState): WorldState => {
  if (state.phase === 'ready') {
    const generated = generateDungeon(state)
    setPhase(generated, 'generated')
    return generated
  }
  if (state.phase === 'generated') setPhase(state, 'exploration')
  else if (state.phase === 'reconnect') {
    setPhase(state, state.returnPhase ?? 'lobby')
    state.returnPhase = null
  } else if (state.phase === 'rematch') return resetRematch(state)
  return state
}

export const simulateTick = (current: WorldState): WorldState => {
  let state = cloneWorld(current)
  state.tick += 1
  state = advanceLifecycle(state)
  if (state.phase !== 'exploration' && state.phase !== 'boss') return state
  tickPlayers(state)
  tickEnemies(state)
  tickProjectiles(state)
  const boss = state.enemies['enemy:boss']
  if (boss?.active && boss.health <= 0) setPhase(state, 'victory')
  else if (livingPlayers(state).length === 0) setPhase(state, 'defeat')
  return state
}
