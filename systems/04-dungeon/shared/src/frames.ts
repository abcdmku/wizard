import { z } from 'zod'
import {
  CommandIdSchema,
  EpochSchema,
  InstanceIdSchema,
  PartyIdSchema,
  PlayerIdSchema,
  SequenceSchema,
  TickSchema,
  TimestampSchema,
} from './domain.js'
import { PlayerProjectionSchema } from './projection.js'
import { ProtocolErrorCodeSchema, ProtocolErrorSchema } from './protocol.js'

export const PROTOCOL_VERSION = 1 as const
export const MAX_SERVER_FRAME_BYTES = 25_000
export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION)

const ServerFrameBaseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    partyId: PartyIdSchema,
    sequence: SequenceSchema,
    tick: TickSchema,
  })
  .strict()

export const WelcomeFrameSchema = ServerFrameBaseSchema.extend({
  type: z.literal('welcome'),
  playerId: PlayerIdSchema,
  instanceId: InstanceIdSchema,
  epoch: EpochSchema,
}).strict()

export const AckSuccessFrameSchema = ServerFrameBaseSchema.extend({
  type: z.literal('ack'),
  commandId: CommandIdSchema,
  ok: z.literal(true),
  replayed: z.boolean(),
}).strict()

export const AckFailureFrameSchema = ServerFrameBaseSchema.extend({
  type: z.literal('ack'),
  commandId: CommandIdSchema,
  ok: z.literal(false),
  code: ProtocolErrorCodeSchema,
  message: z.string().trim().min(1).max(240),
  retryable: z.boolean(),
}).strict()

export const AckFrameSchema = z.discriminatedUnion('ok', [
  AckSuccessFrameSchema,
  AckFailureFrameSchema,
])

export const SnapshotFrameSchema = ServerFrameBaseSchema.extend({
  type: z.literal('snapshot'),
  instanceId: InstanceIdSchema,
  epoch: EpochSchema,
  sentAt: TimestampSchema,
  projection: PlayerProjectionSchema,
})
  .strict()
  .superRefine((frame, context) => {
    if (
      frame.partyId !== frame.projection.partyId ||
      frame.sequence !== frame.projection.sequence ||
      frame.tick !== frame.projection.tick
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projection'],
        message: 'snapshot metadata must match its projection',
      })
    }
  })

export const ErrorFrameSchema = ServerFrameBaseSchema.extend({
  type: z.literal('error'),
  commandId: CommandIdSchema.nullable(),
  error: ProtocolErrorSchema,
}).strict()

export const ServerFrameSchema = z.union([
  WelcomeFrameSchema,
  AckFrameSchema,
  SnapshotFrameSchema,
  ErrorFrameSchema,
])

export function serializedFrameBytes(frame: ServerFrame): number {
  return new TextEncoder().encode(JSON.stringify(frame)).byteLength
}

export function isServerFrameWithinLimit(frame: ServerFrame): boolean {
  return serializedFrameBytes(frame) <= MAX_SERVER_FRAME_BYTES
}

export type WelcomeFrame = z.infer<typeof WelcomeFrameSchema>
export type AckSuccessFrame = z.infer<typeof AckSuccessFrameSchema>
export type AckFailureFrame = z.infer<typeof AckFailureFrameSchema>
export type AckFrame = z.infer<typeof AckFrameSchema>
export type SnapshotFrame = z.infer<typeof SnapshotFrameSchema>
export type ErrorFrame = z.infer<typeof ErrorFrameSchema>
export type ServerFrame = z.infer<typeof ServerFrameSchema>
