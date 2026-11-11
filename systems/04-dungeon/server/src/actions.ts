import type {
  DomainResult,
  InventoryItem,
  PlayerCommand,
  PlayerState,
  ReducedWorld,
  WorldState,
} from './domain.js'
import { INTERACTION_RANGE_UNITS } from './domain.js'
import { cloneWorld, distanceSquared, inRange, setPhase, vectorForFacing } from './engine.js'

export const success: DomainResult = { ok: true }
export const failure = (
  code: Exclude<DomainResult, { readonly ok: true }>['code'],
  message: string,
): DomainResult => ({ ok: false, code, message })
export const reduced = (state: WorldState, result: DomainResult = success): ReducedWorld => ({
  state,
  result,
})

const activePhase = (state: WorldState): boolean =>
  state.phase === 'exploration' || state.phase === 'boss'

const connectedReady = (state: WorldState): boolean => {
  const players = Object.values(state.players)
  return (
    players.length >= 2 &&
    players.length <= 4 &&
    players.every((player) => player.presence === 'connected' && player.ready)
  )
}

export const consumeItem = (player: PlayerState, item: InventoryItem): void => {
  item.quantity -= 1
  if (item.quantity <= 0) {
    player.inventory = player.inventory.filter((candidate) => candidate.id !== item.id)
  }
}

export const applyReadyAction = (
  state: WorldState,
  player: PlayerState,
  ready: boolean,
): ReducedWorld => {
  if (state.phase !== 'lobby')
    return reduced(state, failure('INVALID_COMMAND', 'party is not in lobby'))
  player.ready = ready
  if (connectedReady(state)) setPhase(state, 'ready')
  return reduced(state)
}

export const applyMoveAction = (
  state: WorldState,
  player: PlayerState,
  command: Extract<PlayerCommand, { readonly type: 'move' }>,
): ReducedWorld => {
  if (!activePhase(state)) return reduced(state, failure('INVALID_COMMAND', 'party is not active'))
  player.facing = command.direction
  player.move = vectorForFacing(command.direction)
  return reduced(state)
}

const targetEnemy = (state: WorldState, player: PlayerState, targetId: string | undefined) => {
  if (targetId !== undefined) return state.enemies[targetId]
  return Object.values(state.enemies)
    .filter((enemy) => enemy.active && enemy.health > 0)
    .sort((left, right) => {
      const delta = distanceSquared(player, left) - distanceSquared(player, right)
      return delta === 0 ? left.id.localeCompare(right.id) : delta
    })[0]
}

export const applyAttackAction = (
  state: WorldState,
  player: PlayerState,
  targetId: string | undefined,
): ReducedWorld => {
  if (!activePhase(state)) return reduced(state, failure('INVALID_COMMAND', 'party is not active'))
  if (player.attackCooldownTicks > 0) {
    return reduced(state, failure('INVALID_COMMAND', 'attack is cooling down'))
  }
  const enemy = targetEnemy(state, player, targetId)
  if (enemy === undefined || !enemy.active || enemy.health <= 0) {
    return reduced(state, failure('NOT_FOUND', 'enemy not found'))
  }
  if (!inRange(player, enemy, 175))
    return reduced(state, failure('OUT_OF_RANGE', 'enemy is too far away'))
  enemy.health = Math.max(0, enemy.health - 35)
  player.attackCooldownTicks = 5
  if (enemy.kind === 'warden' && enemy.health === 0) {
    const lootId = `loot:sigil:${enemy.id}`
    state.loot[lootId] = { id: lootId, kind: 'sigil', x: enemy.x, y: enemy.y, quantity: 1 }
  }
  if (enemy.kind === 'boss' && enemy.health === 0) setPhase(state, 'victory')
  return reduced(state)
}

const nextSlot = (player: PlayerState): number =>
  player.inventory.reduce((maximum, item) => Math.max(maximum, item.slot + 1), 0)

const inventoryItem = (
  player: PlayerState,
  kind: InventoryItem['kind'],
  id: string,
): InventoryItem => ({
  id,
  kind,
  label:
    kind === 'bound-key'
      ? 'Oathbound key'
      : kind === 'healing-potion'
        ? 'Healing potion'
        : kind === 'fire-bomb'
          ? 'Haste tonic'
          : 'Warden sigil',
  details: kind === 'bound-key' ? 'Only its finder can use it.' : 'A dungeon consumable.',
  quantity: 1,
  slot: nextSlot(player),
  ...(kind === 'bound-key' ? { boundToPlayerId: player.id } : {}),
})

export const applyPickupAction = (
  state: WorldState,
  player: PlayerState,
  lootId: string,
): ReducedWorld => {
  if (!activePhase(state)) return reduced(state, failure('INVALID_COMMAND', 'party is not active'))
  const loot = state.loot[lootId]
  if (loot === undefined) return reduced(state, failure('NOT_FOUND', 'loot not found'))
  if (!inRange(player, loot, INTERACTION_RANGE_UNITS))
    return reduced(state, failure('OUT_OF_RANGE', 'loot is too far away'))
  if (loot.kind === 'bound-key' && loot.boundToPlayerId !== player.id) {
    return reduced(state, failure('KEY_NOT_OWNED', 'the key is bound to another player'))
  }
  const kind =
    loot.kind === 'potion' ? 'healing-potion' : loot.kind === 'bomb' ? 'fire-bomb' : loot.kind
  delete state.loot[loot.id]
  if (kind === 'sigil') {
    state.objective.collected += 1
    if (state.objective.collected >= state.objective.required) {
      const gate = state.fixtures['fixture:boss-gate']
      if (gate !== undefined && gate.state === 'locked') gate.state = 'closed'
    }
  } else player.inventory.push(inventoryItem(player, kind, `item:${state.runId}:${loot.id}`))
  return reduced(state)
}

export const applyItemUseAction = (
  state: WorldState,
  player: PlayerState,
  slot: number,
): ReducedWorld => {
  if (!activePhase(state)) return reduced(state, failure('INVALID_COMMAND', 'party is not active'))
  const item = player.inventory.find((candidate) => candidate.slot === slot)
  if (item === undefined) return reduced(state, failure('NOT_FOUND', 'inventory slot is empty'))
  if (item.kind === 'healing-potion') {
    if (player.health >= player.maxHealth) {
      return reduced(state, failure('INVALID_COMMAND', 'health is already full'))
    }
    player.health = Math.min(player.maxHealth, player.health + 45)
    player.effects = [
      ...player.effects.filter((effect) => effect.kind !== 'shield'),
      { id: `effect:shield:${state.runId}:${state.tick}`, kind: 'shield', remainingTicks: 30 },
    ]
    consumeItem(player, item)
    return reduced(state)
  }
  if (item.kind === 'fire-bomb') {
    player.effects = [
      ...player.effects.filter((effect) => effect.kind !== 'haste'),
      { id: `effect:haste:${state.runId}:${state.tick}`, kind: 'haste', remainingTicks: 25 },
    ]
    consumeItem(player, item)
    return reduced(state)
  }
  return reduced(state, failure('INVALID_COMMAND', 'item cannot be consumed'))
}

export const applyRematchAction = (state: WorldState, player: PlayerState): ReducedWorld => {
  if (state.phase !== 'victory' && state.phase !== 'defeat') {
    return reduced(state, failure('INVALID_COMMAND', 'party is not awaiting a rematch'))
  }
  player.rematch = true
  const eligible = Object.values(state.players).filter(
    (candidate) => candidate.presence === 'connected',
  )
  if (eligible.length > 0 && eligible.every((candidate) => candidate.rematch))
    setPhase(state, 'rematch')
  return reduced(state)
}

export const copyForCommand = cloneWorld
