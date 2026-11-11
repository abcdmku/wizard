import { z } from 'zod'
import {
  CommandIdSchema,
  DirectionSchema,
  EnemyIdSchema,
  EventIdSchema,
  FixtureIdSchema,
  LootIdSchema,
  PartyIdSchema,
  PlayerDisplayNameSchema,
  PlayerIdSchema,
  SequenceSchema,
  SessionIdSchema,
  TenantIdSchema,
  TickSchema,
  TimestampSchema,
} from './domain.js'

// Immutable, trusted connection scope. Never serialize Viewer in commands, frames, or state.
export const ViewerSchema = z
  .object({
    tenantId: TenantIdSchema,
    partyId: PartyIdSchema,
    playerId: PlayerIdSchema,
    sessionId: SessionIdSchema,
  })
  .strict()
  .readonly()

export const JoinDungeonInputSchema = z
  .object({
    partyId: PartyIdSchema,
    displayName: PlayerDisplayNameSchema,
  })
  .strict()

export const DungeonInputSchema = JoinDungeonInputSchema

export const ReadyCommandSchema = z
  .object({ type: z.literal('ready'), ready: z.boolean() })
  .strict()
export const MoveCommandSchema = z
  .object({ type: z.literal('move'), direction: DirectionSchema })
  .strict()
export const AttackCommandSchema = z
  .object({ type: z.literal('attack'), targetId: EnemyIdSchema.optional() })
  .strict()
export const InteractCommandSchema = z
  .object({ type: z.literal('interact'), targetId: FixtureIdSchema })
  .strict()
export const PickupCommandSchema = z
  .object({ type: z.literal('pickup'), lootId: LootIdSchema })
  .strict()
export const ItemUseCommandSchema = z
  .object({ type: z.literal('item-use'), slot: z.number().int().nonnegative() })
  .strict()
export const RematchCommandSchema = z.object({ type: z.literal('rematch') }).strict()

export const ExternalCommandSchema = z.discriminatedUnion('type', [
  ReadyCommandSchema,
  MoveCommandSchema,
  AttackCommandSchema,
  InteractCommandSchema,
  PickupCommandSchema,
  ItemUseCommandSchema,
  RematchCommandSchema,
])

export const ClientCommandSchema = ExternalCommandSchema

export const ClientCommandMessageSchema = z
  .object({
    type: z.literal('command'),
    partyId: PartyIdSchema,
    commandId: CommandIdSchema,
    expectedSequence: SequenceSchema.optional(),
    command: ExternalCommandSchema,
  })
  .strict()

export const RequestSnapshotMessageSchema = z
  .object({
    type: z.literal('request-snapshot'),
    partyId: PartyIdSchema,
    afterSequence: SequenceSchema.optional(),
  })
  .strict()

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientCommandMessageSchema,
  RequestSnapshotMessageSchema,
])

// The server constructs this only after parsing ClientCommandMessage with trusted Viewer scope.
export const AuthenticatedCommandSchema = z
  .object({
    viewer: ViewerSchema,
    message: ClientCommandMessageSchema,
    receivedAt: TimestampSchema,
  })
  .strict()
  .superRefine((authenticated, context) => {
    if (authenticated.viewer.partyId !== authenticated.message.partyId) {
      context.addIssue({
        code: 'custom',
        path: ['message', 'partyId'],
        message: 'command party must match the trusted viewer party',
      })
    }
  })

const InternalEventBaseSchema = z
  .object({
    eventId: EventIdSchema,
    partyId: PartyIdSchema,
    sequence: SequenceSchema,
    tick: TickSchema,
    occurredAt: TimestampSchema,
  })
  .strict()

export const WorldTickEventSchema = InternalEventBaseSchema.extend({
  type: z.literal('world.tick'),
}).strict()

export const PlayerCommandEventSchema = InternalEventBaseSchema.extend({
  type: z.literal('player.command'),
  playerId: PlayerIdSchema,
  commandId: CommandIdSchema,
  expectedSequence: SequenceSchema.optional(),
  command: ExternalCommandSchema,
}).strict()

export const PlayerConnectedEventSchema = InternalEventBaseSchema.extend({
  type: z.literal('player.connected'),
  playerId: PlayerIdSchema,
}).strict()

export const PlayerDisconnectedEventSchema = InternalEventBaseSchema.extend({
  type: z.literal('player.disconnected'),
  playerId: PlayerIdSchema,
}).strict()

export const InternalGameEventSchema = z.discriminatedUnion('type', [
  WorldTickEventSchema,
  PlayerCommandEventSchema,
  PlayerConnectedEventSchema,
  PlayerDisconnectedEventSchema,
])

export const DungeonEventSchema = InternalGameEventSchema

export const ProtocolErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'invalid-command',
  'not-found',
  'sequence-conflict',
  'out-of-range',
  'key-not-owned',
  'door-already-open',
  'rate-limited',
  'server-error',
])

export const ProtocolErrorSchema = z
  .object({
    code: ProtocolErrorCodeSchema,
    message: z.string().trim().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict()

export type Viewer = z.infer<typeof ViewerSchema>
export type JoinDungeonInput = z.infer<typeof JoinDungeonInputSchema>
export type DungeonInput = z.infer<typeof DungeonInputSchema>
export type ReadyCommand = z.infer<typeof ReadyCommandSchema>
export type MoveCommand = z.infer<typeof MoveCommandSchema>
export type AttackCommand = z.infer<typeof AttackCommandSchema>
export type InteractCommand = z.infer<typeof InteractCommandSchema>
export type PickupCommand = z.infer<typeof PickupCommandSchema>
export type ItemUseCommand = z.infer<typeof ItemUseCommandSchema>
export type RematchCommand = z.infer<typeof RematchCommandSchema>
export type ExternalCommand = z.infer<typeof ExternalCommandSchema>
export type ClientCommand = z.infer<typeof ClientCommandSchema>
export type ClientCommandMessage = z.infer<typeof ClientCommandMessageSchema>
export type RequestSnapshotMessage = z.infer<typeof RequestSnapshotMessageSchema>
export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type AuthenticatedCommand = z.infer<typeof AuthenticatedCommandSchema>
export type WorldTickEvent = z.infer<typeof WorldTickEventSchema>
export type PlayerCommandEvent = z.infer<typeof PlayerCommandEventSchema>
export type PlayerConnectedEvent = z.infer<typeof PlayerConnectedEventSchema>
export type PlayerDisconnectedEvent = z.infer<typeof PlayerDisconnectedEventSchema>
export type InternalGameEvent = z.infer<typeof InternalGameEventSchema>
export type DungeonEvent = z.infer<typeof DungeonEventSchema>
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>
