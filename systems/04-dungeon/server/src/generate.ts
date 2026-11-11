import {
  type DungeonMap,
  type EnemyState,
  type FixtureState,
  type LootState,
  type SeedPlayer,
  UNITS_PER_TILE,
  type WorldState,
} from './domain.js'

const WIDTH = 20
const HEIGHT = 14

interface RandomSource {
  next(max: number): number
}

const randomSource = (initialSeed: number): RandomSource => {
  let state = initialSeed === 0 ? 0x9e3779b9 : initialSeed >>> 0
  return {
    next(max) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return (state >>> 0) % max
    },
  }
}

const emptyMap = (): DungeonMap => ({ width: 1, height: 1, tileSize: 32, rows: ['.'] })

const carveMap = (seed: number): DungeonMap => {
  const random = randomSource(seed)
  const grid: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) =>
      x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? '#' : '.',
    ),
  )
  for (let y = 1; y < HEIGHT - 1; y += 1) grid[y]?.splice(10, 1, '#')
  grid[7]?.splice(10, 1, '+')
  const reserved = new Set(['2,2', '3,2', '4,3', '8,7', '9,7', '11,7', '17,9', '17,10'])
  for (let index = 0; index < 10; index += 1) {
    const x = 2 + random.next(WIDTH - 4)
    const y = 2 + random.next(HEIGHT - 4)
    if (x !== 10 && !reserved.has(`${x},${y}`)) grid[y]?.splice(x, 1, '#')
  }
  return { width: WIDTH, height: HEIGHT, tileSize: 32, rows: grid.map((row) => row.join('')) }
}

const enemies = (seed: number): Record<string, EnemyState> => {
  const offset = seed % 3
  const values: EnemyState[] = [
    {
      id: 'enemy:crawler:1',
      kind: 'crawler',
      x: (6 + offset) * UNITS_PER_TILE + 50,
      y: 5 * UNITS_PER_TILE + 50,
      facing: 'west',
      health: 40,
      maxHealth: 40,
      attackCooldownTicks: 0,
      active: true,
    },
    {
      id: 'enemy:warden:1',
      kind: 'warden',
      x: 14 * UNITS_PER_TILE + 50,
      y: (4 + offset) * UNITS_PER_TILE + 50,
      facing: 'west',
      health: 70,
      maxHealth: 70,
      attackCooldownTicks: 0,
      active: true,
    },
    {
      id: 'enemy:boss',
      kind: 'boss',
      x: 17 * UNITS_PER_TILE + 50,
      y: 10 * UNITS_PER_TILE + 50,
      facing: 'west',
      health: 260,
      maxHealth: 260,
      attackCooldownTicks: 0,
      active: false,
    },
  ]
  return Object.fromEntries(values.map((enemy) => [enemy.id, enemy]))
}

const loot = (boundPlayerId: string | undefined): Record<string, LootState> => {
  const values: LootState[] = [
    {
      id: 'loot:bound-key',
      kind: 'bound-key',
      x: 4 * UNITS_PER_TILE + 50,
      y: 3 * UNITS_PER_TILE + 50,
      quantity: 1,
      ...(boundPlayerId === undefined ? {} : { boundToPlayerId: boundPlayerId }),
    },
    {
      id: 'loot:potion:1',
      kind: 'potion',
      x: 7 * UNITS_PER_TILE + 50,
      y: 9 * UNITS_PER_TILE + 50,
      quantity: 1,
    },
    {
      id: 'loot:bomb:1',
      kind: 'bomb',
      x: 8 * UNITS_PER_TILE + 50,
      y: 9 * UNITS_PER_TILE + 50,
      quantity: 1,
    },
  ]
  return Object.fromEntries(values.map((item) => [item.id, item]))
}

const fixtures = (): Record<string, FixtureState> => {
  const values: FixtureState[] = [
    {
      id: 'fixture:shared-door',
      kind: 'shared-door',
      state: 'locked',
      x: 10 * UNITS_PER_TILE + 50,
      y: 7 * UNITS_PER_TILE + 50,
    },
    {
      id: 'fixture:boss-gate',
      kind: 'boss-gate',
      state: 'locked',
      x: 17 * UNITS_PER_TILE + 50,
      y: 9 * UNITS_PER_TILE + 50,
    },
  ]
  return Object.fromEntries(values.map((fixture) => [fixture.id, fixture]))
}

export const createInitialWorld = (
  partyId: string,
  seed: number,
  roster: readonly SeedPlayer[],
): WorldState => ({
  schemaVersion: 1,
  partyId,
  seed: seed >>> 0,
  runId: 1,
  tick: 0,
  phase: 'lobby',
  returnPhase: null,
  phaseEnteredTick: 0,
  map: emptyMap(),
  players: Object.fromEntries(
    [...roster]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((player, index) => [
        player.id,
        {
          id: player.id,
          name: player.name,
          x: (2 + (index % 2)) * UNITS_PER_TILE + 50,
          y: (2 + Math.floor(index / 2)) * UNITS_PER_TILE + 50,
          facing: 'east' as const,
          health: 100,
          maxHealth: 100,
          ready: false,
          rematch: false,
          presence: 'disconnected' as const,
          connectionEpoch: 0,
          inventory: [],
          effects: [],
          move: { x: 0, y: 0 },
          attackCooldownTicks: 0,
        },
      ]),
  ),
  enemies: {},
  loot: {},
  fixtures: {},
  projectiles: {},
  objective: { collected: 0, required: 1, sharedDoorOpen: false, bossGateOpen: false },
})

export const generateDungeon = (state: WorldState): WorldState => ({
  ...state,
  map: carveMap(state.seed ^ state.runId),
  enemies: enemies(state.seed ^ state.runId),
  loot: loot(Object.keys(state.players).sort()[0]),
  fixtures: fixtures(),
  projectiles: {},
  objective: { collected: 0, required: 1, sharedDoorOpen: false, bossGateOpen: false },
})
