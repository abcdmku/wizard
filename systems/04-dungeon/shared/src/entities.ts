import { z } from 'zod'
import {
  DirectionSchema,
  DoorIdSchema,
  DungeonContextSchema,
  DungeonMapSchema,
  DungeonPhaseSchema,
  EnemyIdSchema,
  EntityIdSchema,
  FixtureIdSchema,
  KeyIdSchema,
  LootIdSchema,
  ObjectiveIdSchema,
  PlayerDisplayNameSchema,
  type PlayerId,
  PlayerIdSchema,
  ProjectileIdSchema,
  SequenceSchema,
  TickSchema,
  type WorldPosition,
  WorldPositionSchema,
} from './domain.js'

export const PlayerBoundKeySchema = z
  .object({
    kind: z.literal('player-bound-key'),
    id: KeyIdSchema,
    boundToPlayerId: PlayerIdSchema,
  })
  .strict()

export const ConsumableTypeSchema = z.enum(['health-potion', 'shield-tonic', 'haste-tonic'])

export const ConsumableSchema = z
  .object({
    kind: z.literal('consumable'),
    id: EntityIdSchema,
    consumableType: ConsumableTypeSchema,
    charges: z.number().int().positive(),
  })
  .strict()

export const InventoryItemSchema = z.discriminatedUnion('kind', [
  PlayerBoundKeySchema,
  ConsumableSchema,
])

export const PlayerInventorySchema = z
  .object({
    items: z.array(InventoryItemSchema).max(12),
  })
  .strict()

export const PlayerEffectSchema = z
  .object({
    id: EntityIdSchema,
    name: z.enum(['haste', 'shield', 'regeneration', 'poison']),
    remainingTicks: z.number().int().positive(),
    stacks: z.number().int().positive().max(8),
  })
  .strict()

export const PlayerPresenceSchema = z.enum(['connected', 'disconnected', 'reconnecting'])
export const PlayerStatusSchema = z.enum(['alive', 'downed', 'escaped'])

export const PublicPlayerStateBaseSchema = z
  .object({
    kind: z.literal('player'),
    id: PlayerIdSchema,
    displayName: PlayerDisplayNameSchema,
    position: WorldPositionSchema,
    facing: DirectionSchema,
    health: z.number().int().nonnegative(),
    maxHealth: z.number().int().positive(),
    ready: z.boolean(),
    rematchVote: z.boolean(),
    presence: PlayerPresenceSchema,
    status: PlayerStatusSchema,
  })
  .strict()

export const PlayerStateSchema = PublicPlayerStateBaseSchema.extend({
  inventory: PlayerInventorySchema,
  effects: z.array(PlayerEffectSchema),
})
  .strict()
  .superRefine((player, context) => {
    if (player.health > player.maxHealth) {
      context.addIssue({ code: 'custom', path: ['health'], message: 'health exceeds maxHealth' })
    }
    for (const [index, item] of player.inventory.items.entries()) {
      if (item.kind === 'player-bound-key' && item.boundToPlayerId !== player.id) {
        context.addIssue({
          code: 'custom',
          path: ['inventory', 'items', index, 'boundToPlayerId'],
          message: 'a player may only carry a key bound to that player',
        })
      }
    }
  })

export const EnemyRankSchema = z.enum(['minion', 'elite', 'boss'])
export const EnemySchema = z
  .object({
    kind: z.literal('enemy'),
    id: EnemyIdSchema,
    enemyType: z.enum(['crawler', 'sentinel', 'wraith', 'dungeon-heart']),
    rank: EnemyRankSchema,
    position: WorldPositionSchema,
    facing: DirectionSchema,
    health: z.number().int().nonnegative(),
    maxHealth: z.number().int().positive(),
    status: z.enum(['alive', 'defeated']),
  })
  .strict()

export const FinalBossSchema = EnemySchema.extend({ rank: z.literal('boss') }).strict()

export const WorldLootSchema = z
  .object({
    kind: z.literal('loot'),
    id: LootIdSchema,
    position: WorldPositionSchema,
    item: InventoryItemSchema,
  })
  .strict()

export const SharedDoorBaseSchema = z
  .object({
    kind: z.literal('shared-door'),
    id: DoorIdSchema,
    position: WorldPositionSchema,
    state: z.enum(['locked', 'open']),
    openedByPlayerId: PlayerIdSchema.nullable(),
    openedAtSequence: SequenceSchema.nullable(),
  })
  .strict()

function hasConsistentDoorState(door: z.infer<typeof SharedDoorBaseSchema>): boolean {
  const hasOpenMetadata = door.openedByPlayerId !== null && door.openedAtSequence !== null
  return (door.state === 'open') === hasOpenMetadata
}

export const PublicSharedDoorSchema = SharedDoorBaseSchema.superRefine((door, context) => {
  if (!hasConsistentDoorState(door)) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'open metadata must match door state',
    })
  }
})

export const SharedDoorSchema = SharedDoorBaseSchema.extend({
  requiredKeyId: KeyIdSchema,
}).superRefine((door, context) => {
  if (!hasConsistentDoorState(door)) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'open metadata must match door state',
    })
  }
})

export const WorldFixtureSchema = z
  .object({
    kind: z.literal('fixture'),
    id: FixtureIdSchema,
    fixtureType: z.enum(['exit', 'chest', 'switch', 'altar']),
    position: WorldPositionSchema,
    state: z.enum(['inactive', 'active', 'spent']),
  })
  .strict()

export const DungeonFixtureSchema = z.discriminatedUnion('kind', [
  SharedDoorSchema,
  WorldFixtureSchema,
])

export const ProjectileSchema = z
  .object({
    kind: z.literal('projectile'),
    id: ProjectileIdSchema,
    ownerId: EntityIdSchema,
    position: WorldPositionSchema,
    direction: DirectionSchema,
    damage: z.number().int().positive(),
    expiresAtTick: TickSchema,
  })
  .strict()

export const SharedObjectiveSchema = z
  .object({
    id: ObjectiveIdSchema,
    kind: z.enum(['explore', 'open-door', 'defeat-enemies', 'defeat-boss', 'escape']),
    label: z.string().trim().min(1).max(120),
    progress: z.number().int().nonnegative(),
    target: z.number().int().positive(),
    completed: z.boolean(),
  })
  .strict()

export const DungeonEntitySchema = z.discriminatedUnion('kind', [
  PlayerStateSchema,
  EnemySchema,
  WorldLootSchema,
  SharedDoorSchema,
  WorldFixtureSchema,
  ProjectileSchema,
])

export const DungeonStateSchema = z
  .object({
    context: DungeonContextSchema,
    sequence: SequenceSchema,
    tick: TickSchema,
    phase: DungeonPhaseSchema,
    map: DungeonMapSchema.nullable(),
    players: z.array(PlayerStateSchema).min(2).max(4),
    enemies: z.array(EnemySchema),
    loot: z.array(WorldLootSchema),
    fixtures: z.array(DungeonFixtureSchema),
    projectiles: z.array(ProjectileSchema),
    objective: SharedObjectiveSchema,
  })
  .strict()

export const INTERACTION_RANGE_TILES = 1.25

export function isInInteractionRange(
  playerPosition: WorldPosition,
  targetPosition: WorldPosition,
  maxDistance: number,
): boolean {
  if (!Number.isFinite(maxDistance) || maxDistance < 0) return false
  const deltaX = playerPosition.x - targetPosition.x
  const deltaY = playerPosition.y - targetPosition.y
  return deltaX * deltaX + deltaY * deltaY <= maxDistance * maxDistance
}

export function canUseBoundKey(playerId: PlayerId, key: PlayerBoundKey): boolean {
  return key.boundToPlayerId === playerId
}

export function findUsableDoorKey(
  player: PlayerState,
  door: SharedDoor,
): PlayerBoundKey | undefined {
  for (const item of player.inventory.items) {
    if (
      item.kind === 'player-bound-key' &&
      item.id === door.requiredKeyId &&
      canUseBoundKey(player.id, item)
    ) {
      return item
    }
  }
  return undefined
}

export function canPlayerOpenDoor(
  player: PlayerState,
  door: SharedDoor,
  interactionRange: number,
): boolean {
  return (
    player.status === 'alive' &&
    door.state === 'locked' &&
    isInInteractionRange(player.position, door.position, interactionRange) &&
    findUsableDoorKey(player, door) !== undefined
  )
}

export type PlayerBoundKey = z.infer<typeof PlayerBoundKeySchema>
export type Consumable = z.infer<typeof ConsumableSchema>
export type InventoryItem = z.infer<typeof InventoryItemSchema>
export type PlayerInventory = z.infer<typeof PlayerInventorySchema>
export type PlayerEffect = z.infer<typeof PlayerEffectSchema>
export type PublicPlayerStateBase = z.infer<typeof PublicPlayerStateBaseSchema>
export type PlayerState = z.infer<typeof PlayerStateSchema>
export type Enemy = z.infer<typeof EnemySchema>
export type FinalBoss = z.infer<typeof FinalBossSchema>
export type WorldLoot = z.infer<typeof WorldLootSchema>
export type SharedDoor = z.infer<typeof SharedDoorSchema>
export type PublicSharedDoor = z.infer<typeof PublicSharedDoorSchema>
export type WorldFixture = z.infer<typeof WorldFixtureSchema>
export type DungeonFixture = z.infer<typeof DungeonFixtureSchema>
export type Projectile = z.infer<typeof ProjectileSchema>
export type SharedObjective = z.infer<typeof SharedObjectiveSchema>
export type DungeonEntity = z.infer<typeof DungeonEntitySchema>
export type DungeonState = z.infer<typeof DungeonStateSchema>
