import { DungeonMapSchema } from './domain.js'
import {
  type DungeonState,
  DungeonStateSchema,
  type PlayerBoundKey,
  type PlayerState,
  PlayerStateSchema,
  type SharedDoor,
  SharedDoorSchema,
} from './entities.js'
import type { Viewer } from './protocol.js'

export const fixtureNow = '2026-08-23T12:00:00.000Z'

const makePlayer = (
  id: string,
  x: number,
  inventory: PlayerState['inventory'],
  effects: PlayerState['effects'],
): PlayerState =>
  PlayerStateSchema.parse({
    kind: 'player',
    id,
    displayName: id === 'player-1' ? 'Aria' : 'Bram',
    position: { x, y: 64 },
    facing: 'east',
    health: 8,
    maxHealth: 10,
    ready: true,
    rematchVote: false,
    presence: 'connected',
    status: 'alive',
    inventory,
    effects,
  })

export const ownerKey: PlayerBoundKey = {
  kind: 'player-bound-key',
  id: 'key-1',
  boundToPlayerId: 'player-1',
}

export const owner = makePlayer('player-1', 64, { items: [ownerKey] }, [
  { id: 'effect-self', name: 'shield', remainingTicks: 20, stacks: 1 },
])

export const teammate = makePlayer(
  'player-2',
  128,
  {
    items: [
      {
        kind: 'consumable',
        id: 'teammate-secret-item',
        consumableType: 'health-potion',
        charges: 1,
      },
    ],
  },
  [{ id: 'teammate-secret-effect', name: 'poison', remainingTicks: 99, stacks: 2 }],
)

export const door: SharedDoor = SharedDoorSchema.parse({
  kind: 'shared-door',
  id: 'door-1',
  position: { x: 96, y: 64 },
  requiredKeyId: 'key-1',
  state: 'locked',
  openedByPlayerId: null,
  openedAtSequence: null,
})

const dungeonMap = DungeonMapSchema.parse({
  id: 'map-1',
  name: 'Test room',
  width: 2,
  height: 2,
  tileSize: 64,
  rows: ['S.', '#E'],
  spawnPoints: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
})

export const projectionState: DungeonState = DungeonStateSchema.parse({
  context: {
    partyId: 'party-1',
    dungeonId: 'dungeon-1',
    instanceId: 'instance-1',
    epoch: 1,
    minPlayers: 2,
    maxPlayers: 4,
    createdAt: fixtureNow,
  },
  sequence: 7,
  tick: 12,
  phase: 'exploration',
  map: dungeonMap,
  players: [owner, teammate],
  enemies: [
    {
      kind: 'enemy',
      id: 'boss-1',
      enemyType: 'dungeon-heart',
      rank: 'boss',
      position: { x: 256, y: 64 },
      facing: 'west',
      health: 100,
      maxHealth: 100,
      status: 'alive',
    },
  ],
  loot: [
    {
      kind: 'loot',
      id: 'loot-1',
      position: { x: 192, y: 64 },
      item: { kind: 'player-bound-key', id: 'key-2', boundToPlayerId: 'player-2' },
    },
  ],
  fixtures: [door],
  projectiles: [],
  objective: {
    id: 'objective-1',
    kind: 'open-door',
    label: 'Open the shared door',
    progress: 0,
    target: 1,
    completed: false,
  },
})

export const viewer: Viewer = {
  tenantId: 'tenant-1',
  partyId: 'party-1',
  playerId: 'player-1',
  sessionId: 'session-1',
}

export const teammateViewer: Viewer = {
  tenantId: 'tenant-1',
  partyId: 'party-1',
  playerId: 'player-2',
  sessionId: 'session-2',
}
