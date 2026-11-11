import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(64)

export const TenantIdSchema = IdentifierSchema.describe('TenantId')
export const PartyIdSchema = IdentifierSchema.describe('PartyId')
export const DungeonIdSchema = IdentifierSchema.describe('DungeonId')
export const InstanceIdSchema = IdentifierSchema.describe('InstanceId')
export const MapIdSchema = IdentifierSchema.describe('MapId')
export const PlayerIdSchema = IdentifierSchema.describe('PlayerId')
export const PlayerDisplayNameSchema = z.string().trim().min(1).max(32)
export const SessionIdSchema = IdentifierSchema.describe('SessionId')
export const EntityIdSchema = IdentifierSchema.describe('EntityId')
export const EnemyIdSchema = IdentifierSchema.describe('EnemyId')
export const LootIdSchema = IdentifierSchema.describe('LootId')
export const ProjectileIdSchema = IdentifierSchema.describe('ProjectileId')
export const FixtureIdSchema = IdentifierSchema.describe('FixtureId')
export const ObjectiveIdSchema = IdentifierSchema.describe('ObjectiveId')
export const KeyIdSchema = IdentifierSchema.describe('KeyId')
export const DoorIdSchema = IdentifierSchema.describe('DoorId')
export const CommandIdSchema = IdentifierSchema.describe('CommandId')
export const EventIdSchema = IdentifierSchema.describe('EventId')
export const SequenceSchema = z.number().int().nonnegative()
export const TickSchema = z.number().int().nonnegative()
export const EpochSchema = z.number().int().nonnegative()
export const TimestampSchema = z.iso.datetime({ offset: true })

export const SeedPlayerSchema = z
  .object({
    id: PlayerIdSchema,
    name: PlayerDisplayNameSchema,
  })
  .strict()

export const GridPositionSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict()

// Serialized entity positions are world pixels. Server fixed-point values stay internal.
export const WorldPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict()

export const DirectionSchema = z.enum(['north', 'east', 'south', 'west'])
export const TileKindSchema = z.enum(['floor', 'wall', 'doorway', 'spawn', 'exit', 'hazard'])

export const DungeonTileSchema = z
  .object({
    position: GridPositionSchema,
    kind: TileKindSchema,
    walkable: z.boolean(),
    blocksSight: z.boolean(),
  })
  .strict()

export const DungeonMapRowSchema = z
  .string()
  .min(1)
  .regex(/^[#.+SE^]+$/)

export const DungeonMapSchema = z
  .object({
    id: MapIdSchema,
    name: z.string().trim().min(1).max(80),
    width: z.number().int().positive().max(256),
    height: z.number().int().positive().max(256),
    tileSize: z.number().int().positive().max(512),
    rows: z.array(DungeonMapRowSchema).min(1),
    spawnPoints: z.array(GridPositionSchema).min(2).max(4),
  })
  .strict()
  .superRefine((map, context) => {
    if (map.rows.length !== map.height) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'row count must match map height',
      })
    }
    for (const [rowIndex, row] of map.rows.entries()) {
      if (row.length !== map.width) {
        context.addIssue({
          code: 'custom',
          path: ['rows', rowIndex],
          message: 'each compact map row must contain exactly map width glyphs',
        })
      }
    }
  })

export const DungeonPhaseSchema = z.enum([
  'lobby',
  'ready',
  'generated',
  'exploration',
  'boss',
  'victory',
  'defeat',
  'disconnect',
  'reconnect',
  'rematch',
])

export const DungeonContextSchema = z
  .object({
    partyId: PartyIdSchema,
    dungeonId: DungeonIdSchema,
    instanceId: InstanceIdSchema,
    epoch: EpochSchema,
    minPlayers: z.literal(2),
    maxPlayers: z.number().int().min(2).max(4),
    createdAt: TimestampSchema,
  })
  .strict()

export const DungeonOutputSchema = z
  .object({
    partyId: PartyIdSchema,
    instanceId: InstanceIdSchema,
    outcome: z.enum(['victory', 'defeat', 'abandoned']),
    completedAt: TimestampSchema,
    survivingPlayerIds: z.array(PlayerIdSchema).max(4),
    finalTick: TickSchema,
  })
  .strict()

export type TenantId = z.infer<typeof TenantIdSchema>
export type PartyId = z.infer<typeof PartyIdSchema>
export type DungeonId = z.infer<typeof DungeonIdSchema>
export type InstanceId = z.infer<typeof InstanceIdSchema>
export type PlayerId = z.infer<typeof PlayerIdSchema>
export type PlayerDisplayName = z.infer<typeof PlayerDisplayNameSchema>
export type SeedPlayer = z.infer<typeof SeedPlayerSchema>
export type SessionId = z.infer<typeof SessionIdSchema>
export type GridPosition = z.infer<typeof GridPositionSchema>
export type WorldPosition = z.infer<typeof WorldPositionSchema>
export type Direction = z.infer<typeof DirectionSchema>
export type DungeonTile = z.infer<typeof DungeonTileSchema>
export type DungeonMapRow = z.infer<typeof DungeonMapRowSchema>
export type DungeonMap = z.infer<typeof DungeonMapSchema>
export type DungeonPhase = z.infer<typeof DungeonPhaseSchema>
export type DungeonContext = z.infer<typeof DungeonContextSchema>
export type DungeonOutput = z.infer<typeof DungeonOutputSchema>
