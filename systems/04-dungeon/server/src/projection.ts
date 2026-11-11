import { boundary, defineProjection } from '@openwizard/core'
import {
  type DungeonFixture,
  type Enemy,
  ParsedDungeonState,
  type PlayerProjection,
  type Projectile,
  projectParsedDungeonForViewer,
  type InventoryItem as SharedInventoryItem,
  type PlayerEffect as SharedPlayerEffect,
  type PlayerState as SharedPlayerState,
  type Viewer,
  type WorldLoot,
  type WorldPosition,
} from '@wizard/dungeon-shared'
import type { FixtureState, InventoryItem, PlayerEffect, WorldState } from './domain.js'
import { sortedValues, UNITS_PER_TILE } from './domain.js'
import { dungeonFlow } from './flow.js'

const worldPosition = (state: WorldState, point: WorldPosition): WorldPosition => ({
  x: (point.x / UNITS_PER_TILE) * state.map.tileSize,
  y: (point.y / UNITS_PER_TILE) * state.map.tileSize,
})

const sharedInventoryItem = (item: InventoryItem): SharedInventoryItem | undefined => {
  if (item.kind === 'sigil') return undefined
  if (item.kind === 'bound-key') {
    if (item.boundToPlayerId === undefined) return undefined
    return { kind: 'player-bound-key', id: item.id, boundToPlayerId: item.boundToPlayerId }
  }
  return {
    kind: 'consumable',
    id: item.id,
    consumableType: item.kind === 'healing-potion' ? 'health-potion' : 'haste-tonic',
    charges: item.quantity,
  }
}

const sharedEffect = (effect: PlayerEffect): SharedPlayerEffect => ({
  id: effect.id,
  name: effect.kind === 'burning' ? 'poison' : effect.kind,
  remainingTicks: effect.remainingTicks,
  stacks: 1,
})

const sharedPlayers = (state: WorldState): SharedPlayerState[] =>
  sortedValues(state.players).map((player) => ({
    kind: 'player',
    id: player.id,
    displayName: player.name,
    position: worldPosition(state, player),
    facing: player.facing,
    health: player.health,
    maxHealth: player.maxHealth,
    ready: player.ready,
    rematchVote: player.rematch,
    presence: player.presence,
    status: player.health > 0 ? 'alive' : 'downed',
    inventory: {
      items: player.inventory.flatMap((item) => {
        const shared = sharedInventoryItem(item)
        return shared === undefined ? [] : [shared]
      }),
    },
    effects: player.effects.map(sharedEffect),
  }))

const enemyType = (kind: WorldState['enemies'][string]['kind']): Enemy['enemyType'] => {
  if (kind === 'warden') return 'sentinel'
  if (kind === 'archer') return 'wraith'
  if (kind === 'boss') return 'dungeon-heart'
  return 'crawler'
}

const sharedEnemies = (state: WorldState): Enemy[] =>
  sortedValues(state.enemies)
    .filter((enemy) => enemy.active)
    .map((enemy) => ({
      kind: 'enemy',
      id: enemy.id,
      enemyType: enemyType(enemy.kind),
      rank: enemy.kind === 'boss' ? 'boss' : enemy.kind === 'warden' ? 'elite' : 'minion',
      position: worldPosition(state, enemy),
      facing: enemy.facing,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      status: enemy.health > 0 ? 'alive' : 'defeated',
    }))

const lootItem = (state: WorldState, loot: WorldState['loot'][string]): WorldLoot['item'] => {
  if (loot.kind === 'bound-key') {
    return {
      kind: 'player-bound-key',
      id: 'key:shared-door',
      boundToPlayerId: loot.boundToPlayerId ?? sortedValues(state.players)[0]?.id ?? 'unassigned',
    }
  }
  return {
    kind: 'consumable',
    id: `item:${loot.kind}`,
    consumableType: loot.kind === 'potion' ? 'health-potion' : 'haste-tonic',
    charges: 1,
  }
}

const sharedLoot = (state: WorldState): WorldLoot[] =>
  sortedValues(state.loot).map((loot) => ({
    kind: 'loot',
    id: loot.id,
    position: worldPosition(state, loot),
    item: lootItem(state, loot),
  }))

const sharedFixture = (state: WorldState, fixture: FixtureState): DungeonFixture => {
  if (fixture.kind === 'shared-door') {
    const open = fixture.state === 'open'
    return {
      kind: 'shared-door',
      id: fixture.id,
      position: worldPosition(state, fixture),
      state: open ? 'open' : 'locked',
      openedByPlayerId: open
        ? (fixture.openedByPlayerId ?? sortedValues(state.players)[0]?.id ?? 'unassigned')
        : null,
      openedAtSequence: open ? (fixture.openedAtSequence ?? state.tick) : null,
      requiredKeyId: 'key:shared-door',
    }
  }
  return {
    kind: 'fixture',
    id: fixture.id,
    fixtureType:
      fixture.kind === 'chest' ? 'chest' : fixture.kind === 'boss-gate' ? 'altar' : 'switch',
    position: worldPosition(state, fixture),
    state: fixture.state === 'open' ? 'spent' : fixture.state === 'closed' ? 'active' : 'inactive',
  }
}

const sharedProjectiles = (state: WorldState): Projectile[] =>
  sortedValues(state.projectiles).map((projectile) => ({
    kind: 'projectile',
    id: projectile.id,
    ownerId: 'enemy:boss',
    position: worldPosition(state, projectile),
    direction: 'east',
    damage: 18,
    expiresAtTick: state.tick + projectile.ttlTicks,
  }))

const sharedMap = (state: WorldState) =>
  state.map.width <= 1
    ? null
    : {
        id: `map:${state.partyId}:${state.runId}`,
        name: 'The Lantern Vault',
        width: state.map.width,
        height: state.map.height,
        tileSize: state.map.tileSize,
        rows: state.map.rows,
        spawnPoints: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 2, y: 3 },
          { x: 3, y: 3 },
        ],
      }

const sharedStateCache = new WeakMap<WorldState, Map<number, Map<number, ParsedDungeonState>>>()

export const toSharedState = (
  state: WorldState,
  sequence = state.tick,
  epoch = 0,
): ParsedDungeonState => {
  let byEpoch = sharedStateCache.get(state)
  if (byEpoch === undefined) {
    byEpoch = new Map()
    sharedStateCache.set(state, byEpoch)
  }
  let bySequence = byEpoch.get(epoch)
  if (bySequence === undefined) {
    bySequence = new Map()
    byEpoch.set(epoch, bySequence)
  }
  const cached = bySequence.get(sequence)
  if (cached !== undefined) return cached
  const shared = ParsedDungeonState.parse({
    context: {
      partyId: state.partyId,
      dungeonId: `dungeon:${state.partyId}`,
      instanceId: `party:${state.partyId}`,
      epoch,
      minPlayers: 2,
      maxPlayers: 4,
      createdAt: new Date(0).toISOString(),
    },
    sequence,
    tick: state.tick,
    phase: state.phase,
    map: sharedMap(state),
    players: sharedPlayers(state),
    enemies: sharedEnemies(state),
    loot: sharedLoot(state),
    fixtures: sortedValues(state.fixtures).map((fixture) => sharedFixture(state, fixture)),
    projectiles: sharedProjectiles(state),
    objective: {
      id: 'objective:wardens',
      kind: state.phase === 'boss' ? 'defeat-boss' : 'defeat-enemies',
      label: state.phase === 'boss' ? 'Defeat the dungeon heart' : 'Defeat the wardens',
      progress: state.phase === 'victory' ? 1 : state.objective.collected,
      target: state.phase === 'boss' || state.phase === 'victory' ? 1 : state.objective.required,
      completed: state.phase === 'victory' || state.objective.collected >= state.objective.required,
    },
  })
  bySequence.set(sequence, shared)
  return shared
}

export const projectState = (
  state: WorldState,
  viewer: Viewer,
  sequence = state.tick,
  epoch = 0,
): PlayerProjection => {
  const projected = projectParsedDungeonForViewer(toSharedState(state, sequence, epoch), viewer)
  if (projected === undefined) throw new Error('viewer is not a member of this party')
  return projected
}

export const dungeonProjection = defineProjection(dungeonFlow, {
  scope: boundary.trusted<Viewer>(),
  select: ({ state, scope }) => projectState(state.context.world, scope, state.seq, state.epoch),
})
