import {
  applyAttackAction,
  applyItemUseAction,
  applyMoveAction,
  applyPickupAction,
  applyReadyAction,
  applyRematchAction,
  consumeItem,
  copyForCommand,
  failure,
  reduced,
  success,
} from './actions.js'
import type {
  DomainResult,
  InventoryItem,
  PlayerCommand,
  PlayerState,
  ReducedWorld,
  WorldState,
} from './domain.js'
import { INTERACTION_RANGE_UNITS } from './domain.js'
import { inRange, setPhase } from './engine.js'
import { createInitialWorld } from './generate.js'

const boundKey = (player: PlayerState): InventoryItem | undefined =>
  player.inventory.find((item) => item.kind === 'bound-key' && item.boundToPlayerId === player.id)

const boundKeyPickupOwner = (state: WorldState, lootId: string): string | undefined => {
  const groundKey = state.loot[lootId]
  if (groundKey?.kind === 'bound-key') return groundKey.boundToPlayerId
  const inventoryId = `item:${state.runId}:${lootId}`
  for (const candidate of Object.values(state.players)) {
    const pickedKey = candidate.inventory.find(
      (item) => item.kind === 'bound-key' && item.id === inventoryId,
    )
    if (pickedKey !== undefined) return pickedKey.boundToPlayerId ?? candidate.id
  }
  return undefined
}

const defeatedPlayerResult = (
  player: PlayerState,
  command: PlayerCommand,
): DomainResult | undefined =>
  player.health <= 0 && command.type !== 'rematch'
    ? failure('INVALID_COMMAND', 'defeated players can only request a rematch')
    : undefined

export const authorizePlayerCommand = (
  state: WorldState,
  playerId: string,
  command: PlayerCommand,
): DomainResult => {
  const player = state.players[playerId]
  if (player === undefined || player.presence !== 'connected') {
    return failure('FORBIDDEN', 'player is not connected to this party')
  }
  const defeated = defeatedPlayerResult(player, command)
  if (defeated !== undefined) return defeated
  if (command.type === 'pickup') {
    const ownerId = boundKeyPickupOwner(state, command.lootId)
    if (ownerId !== undefined && ownerId !== playerId) {
      return failure('KEY_NOT_OWNED', 'the key is bound to another player')
    }
  }
  if (command.type === 'interact') {
    const fixture = state.fixtures[command.targetId]
    if (
      fixture?.kind === 'shared-door' &&
      fixture.state !== 'open' &&
      boundKey(player) === undefined
    ) {
      return failure('KEY_NOT_OWNED', 'this player does not own the required key')
    }
  }
  return success
}

const applyDoorInteraction = (
  state: WorldState,
  player: PlayerState,
  targetId: string,
): ReducedWorld => {
  const fixture = state.fixtures[targetId]
  if (fixture === undefined) return reduced(state, failure('NOT_FOUND', 'fixture not found'))
  if (!inRange(player, fixture, INTERACTION_RANGE_UNITS)) {
    return reduced(state, failure('OUT_OF_RANGE', 'fixture is too far away'))
  }
  if (fixture.state === 'open') {
    return reduced(state, failure('DOOR_ALREADY_OPEN', 'door is already open'))
  }
  if (fixture.kind === 'shared-door') {
    const key = boundKey(player)
    if (key === undefined) {
      return reduced(state, failure('KEY_NOT_OWNED', 'this player does not own the required key'))
    }
    consumeItem(player, key)
    fixture.state = 'open'
    fixture.openedByPlayerId = player.id
    fixture.openedAtSequence = state.tick
    state.objective.sharedDoorOpen = true
    return reduced(state)
  }
  if (fixture.kind === 'boss-gate') {
    if (!state.objective.sharedDoorOpen || state.objective.collected < state.objective.required) {
      return reduced(state, failure('FORBIDDEN', 'the shared objective is incomplete'))
    }
    fixture.state = 'open'
    state.objective.bossGateOpen = true
    const boss = state.enemies['enemy:boss']
    if (boss !== undefined) boss.active = true
    setPhase(state, 'boss')
    return reduced(state)
  }
  fixture.state = 'open'
  return reduced(state)
}

export const applyAuthenticatedPlayerCommand = (
  current: WorldState,
  playerId: string,
  command: PlayerCommand,
): ReducedWorld => {
  const state = copyForCommand(current)
  const player = state.players[playerId]
  if (player === undefined)
    return reduced(current, failure('FORBIDDEN', 'player is not in this party'))
  if (player.presence !== 'connected') {
    return reduced(current, failure('FORBIDDEN', 'player is disconnected'))
  }
  const defeated = defeatedPlayerResult(player, command)
  if (defeated !== undefined) return reduced(current, defeated)
  switch (command.type) {
    case 'ready':
      return applyReadyAction(state, player, command.ready)
    case 'move':
      return applyMoveAction(state, player, command)
    case 'attack':
      return applyAttackAction(state, player, command.targetId)
    case 'interact':
      return applyDoorInteraction(state, player, command.targetId)
    case 'pickup':
      return applyPickupAction(state, player, command.lootId)
    case 'item-use':
      return applyItemUseAction(state, player, command.slot)
    case 'rematch':
      return applyRematchAction(state, player)
  }
}

export const applyPresence = (
  current: WorldState,
  playerId: string,
  connected: boolean,
): WorldState => {
  const state = copyForCommand(current)
  const player = state.players[playerId]
  if (player === undefined) return current
  const wasConnected = player.presence === 'connected'
  const firstLobbyConnection = connected && player.connectionEpoch === 0 && state.phase === 'lobby'
  player.presence = connected ? 'connected' : 'disconnected'
  player.connectionEpoch += 1
  player.move = { x: 0, y: 0 }
  if (firstLobbyConnection || connected === wasConnected) return state
  if (!connected) {
    if (state.phase !== 'disconnect' && state.phase !== 'reconnect') state.returnPhase = state.phase
    setPhase(state, 'disconnect')
    return state
  }
  if (state.phase === 'disconnect') {
    const rosterReturned = Object.values(state.players).every(
      (candidate) => candidate.presence === 'connected',
    )
    if (rosterReturned) setPhase(state, 'reconnect')
  } else {
    state.returnPhase = state.phase
    setPhase(state, 'reconnect')
  }
  return state
}

export const applyAdminReset = (current: WorldState, seed: number): WorldState => {
  const reset = createInitialWorld(
    current.partyId,
    seed,
    Object.values(current.players)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((player) => ({ id: player.id, name: player.name })),
  )
  for (const player of Object.values(reset.players)) {
    const prior = current.players[player.id]
    if (prior === undefined) continue
    player.presence = prior.presence
    player.connectionEpoch = prior.connectionEpoch
  }
  reset.runId = current.runId + 1
  return reset
}
