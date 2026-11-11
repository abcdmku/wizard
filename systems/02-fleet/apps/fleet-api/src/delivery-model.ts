import {
  InterventionActionSchema,
  PriorityBandSchema,
  SeveritySchema,
  VehicleTelemetrySchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'

export const ProcedureStateSchema = Schema.Literals([
  'assignment',
  'pickup',
  'transit',
  'anomaly',
  'dispatcher_intervention',
  'operator_approval',
  'completion',
  'cancellation',
])
export type ProcedureState = typeof ProcedureStateSchema.Type

export const DeliveryContextSchema = Schema.Struct({
  tenantId: Schema.String,
  deliveryId: Schema.String,
  procedureState: ProcedureStateSchema,
  vehicleId: Schema.optional(Schema.String),
  severity: Schema.optional(SeveritySchema),
  anomalyOpenedAtMs: Schema.optional(Schema.Number),
  score: Schema.optional(Schema.Number),
  band: Schema.optional(PriorityBandSchema),
  lastActionBand: Schema.optional(Schema.NullOr(PriorityBandSchema)),
  currentTempC: Schema.optional(Schema.Number),
  lastTelemetryAtMs: Schema.optional(Schema.Number),
  anomalyResolved: Schema.Boolean,
})
export type DeliveryContext = typeof DeliveryContextSchema.Type

export const AssignmentEventSchema = Schema.Struct({
  vehicleId: Schema.String,
  at: Schema.Number,
})
export type AssignmentEvent = typeof AssignmentEventSchema.Type

export const PickupConfirmedEventSchema = Schema.Struct({ at: Schema.Number })
export type PickupConfirmedEvent = typeof PickupConfirmedEventSchema.Type

export const ArrivalEventSchema = Schema.Struct({ at: Schema.Number })
export type ArrivalEvent = typeof ArrivalEventSchema.Type

export const AnomalyResolvedEventSchema = Schema.Struct({
  commandId: Schema.String,
  at: Schema.Number,
  note: Schema.optional(Schema.String),
})
export type AnomalyResolvedEvent = typeof AnomalyResolvedEventSchema.Type

export const InterventionEventSchema = Schema.Struct({
  commandId: Schema.String,
  action: InterventionActionSchema,
  actorRole: Schema.Literals(['dispatcher', 'manager']),
  at: Schema.Number,
  reason: Schema.optional(Schema.String),
})
export type InterventionEvent = typeof InterventionEventSchema.Type

export const ApprovalEventSchema = Schema.Struct({
  commandId: Schema.String,
  approved: Schema.Boolean,
  actorRole: Schema.Literal('manager'),
  at: Schema.Number,
  note: Schema.optional(Schema.String),
})
export type ApprovalEvent = typeof ApprovalEventSchema.Type

export const CancellationEventSchema = Schema.Struct({
  commandId: Schema.String,
  at: Schema.Number,
  reason: Schema.optional(Schema.String),
})
export type CancellationEvent = typeof CancellationEventSchema.Type

export const DeliveryWorkflowEvents = {
  assigned: AssignmentEventSchema,
  pickupConfirmed: PickupConfirmedEventSchema,
  telemetry: VehicleTelemetrySchema,
  arrived: ArrivalEventSchema,
  anomalyResolved: AnomalyResolvedEventSchema,
  intervention: InterventionEventSchema,
  approval: ApprovalEventSchema,
  cancelled: CancellationEventSchema,
} as const

export const AutomatedActionSchema = Schema.Literals([
  'start_assignment',
  'reroute',
  'queue',
  'stop_assignments',
  'page_dispatcher',
  'emergency_stop',
  'page_manager',
  'mark_complete',
])
export type AutomatedAction = typeof AutomatedActionSchema.Type

export const ActionCommandSchema = Schema.Struct({
  tenantId: Schema.String,
  deliveryId: Schema.String,
  action: AutomatedActionSchema,
  idempotencyKey: Schema.String,
  score: Schema.optional(Schema.Number),
})
export type ActionCommand = typeof ActionCommandSchema.Type

export const ActionReceiptSchema = Schema.Struct({
  action: AutomatedActionSchema,
  recordedAtMs: Schema.Number,
})
export type ActionReceipt = typeof ActionReceiptSchema.Type

export class ActionFailure extends Schema.TaggedError<ActionFailure>()('ActionFailure', {
  code: Schema.String,
  message: Schema.String,
}) {}
