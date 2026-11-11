import {
  type Direction,
  type ExternalCommand,
  INTERACTION_RANGE_TILES,
  type SeedPlayer,
  type Viewer,
  type WorldPosition,
} from '@wizard/dungeon-shared'

export const TICK_RATE_HZ = 10
export const TICK_MS = 1_000 / TICK_RATE_HZ
export const UNITS_PER_TILE = 100
export const INTERACTION_RANGE_UNITS = INTERACTION_RANGE_TILES * UNITS_PER_TILE

export type PartyPhase =
  | 'lobby'
  | 'ready'
  | 'generated'
  | 'exploration'
  | 'boss'
  | 'victory'
  | 'defeat'
  | 'disconnect'
  | 'reconnect'
  | 'rematch'

export type Facing = Direction

export interface InventoryItem {
  id: string
  kind: 'healing-potion' | 'fire-bomb' | 'sigil' | 'bound-key'
  label: string
  details: string
  quantity: number
  slot: number
  boundToPlayerId?: string
}

export interface PlayerEffect {
  id: string
  kind: 'shield' | 'haste' | 'burning'
  remainingTicks: number
}

export interface PlayerState extends WorldPosition {
  id: string
  name: string
  facing: Facing
  health: number
  maxHealth: number
  ready: boolean
  rematch: boolean
  presence: 'connected' | 'reconnecting' | 'disconnected'
  connectionEpoch: number
  inventory: InventoryItem[]
  effects: PlayerEffect[]
  move: WorldPosition
  attackCooldownTicks: number
}

export interface EnemyState extends WorldPosition {
  id: string
  kind: 'crawler' | 'archer' | 'warden' | 'boss'
  facing: Facing
  health: number
  maxHealth: number
  attackCooldownTicks: number
  active: boolean
}

export interface LootState extends WorldPosition {
  id: string
  kind: 'potion' | 'bomb' | 'sigil' | 'bound-key'
  quantity: number
  boundToPlayerId?: string
}

export interface FixtureState extends WorldPosition {
  id: string
  kind: 'door' | 'shared-door' | 'chest' | 'boss-gate'
  state: 'closed' | 'open' | 'locked'
  openedByPlayerId?: string
  openedAtSequence?: number
}

export interface ProjectileState extends WorldPosition {
  id: string
  kind: 'arrow' | 'fire' | 'arcane'
  angle: number
  ttlTicks: number
}

export interface DungeonMap {
  width: number
  height: number
  tileSize: number
  rows: string[]
}

export interface ObjectiveState {
  collected: number
  required: number
  sharedDoorOpen: boolean
  bossGateOpen: boolean
}

export interface WorldState {
  schemaVersion: 1
  partyId: string
  seed: number
  runId: number
  tick: number
  phase: PartyPhase
  returnPhase: PartyPhase | null
  phaseEnteredTick: number
  map: DungeonMap
  players: Record<string, PlayerState>
  enemies: Record<string, EnemyState>
  loot: Record<string, LootState>
  fixtures: Record<string, FixtureState>
  projectiles: Record<string, ProjectileState>
  objective: ObjectiveState
}

export type PlayerCommand = ExternalCommand

export type CommandFailureCode =
  | 'INVALID_COMMAND'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'OUT_OF_RANGE'
  | 'STALE'
  | 'BUSY'
  | 'INTERNAL'
  | 'KEY_NOT_OWNED'
  | 'DOOR_ALREADY_OPEN'

export type DomainResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CommandFailureCode; readonly message: string }

export interface ReducedWorld {
  readonly state: WorldState
  readonly result: DomainResult
}

export const sortedValues = <T extends { readonly id: string }>(
  record: Readonly<Record<string, T>>,
): T[] => Object.values(record).sort((left, right) => left.id.localeCompare(right.id))

export type { SeedPlayer, Viewer, WorldPosition }
