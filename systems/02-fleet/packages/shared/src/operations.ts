import { Schema } from 'effect'
import {
  DashboardSchema,
  DurableVersionSchema,
  InterventionActionSchema,
  SeveritySchema,
} from './domain'

export const TrafficSchema = Schema.Literals(['clear', 'moderate', 'heavy', 'blocked'])
export type Traffic = typeof TrafficSchema.Type

export const InterventionRequestSchema = Schema.Struct({
  action: InterventionActionSchema,
  reason: Schema.optional(Schema.String),
  commandId: Schema.String,
  expectedVersion: Schema.optional(DurableVersionSchema),
})
export type InterventionRequest = typeof InterventionRequestSchema.Type

export const InterventionResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  dashboard: DashboardSchema,
})
export type InterventionResponse = typeof InterventionResponseSchema.Type

export const VehicleTelemetrySchema = Schema.Struct({
  commandId: Schema.String,
  capturedAt: Schema.Number,
  position: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    heading: Schema.Number,
  }),
  batteryPercent: Schema.Number,
  tempC: Schema.Number,
  traffic: TrafficSchema,
  fault: Schema.optional(
    Schema.Struct({
      code: Schema.String,
      severity: SeveritySchema,
      detail: Schema.String,
    }),
  ),
})
export type VehicleTelemetry = typeof VehicleTelemetrySchema.Type

export const DeliverySignalSchema = Schema.Struct({
  commandId: Schema.String,
  expectedVersion: Schema.optional(DurableVersionSchema),
  signal: Schema.Literals([
    'assigned',
    'pickup_confirmed',
    'arrived',
    'anomaly_resolved',
    'approval_granted',
    'approval_denied',
    'cancelled',
  ]),
  vehicleId: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
})
export type DeliverySignal = typeof DeliverySignalSchema.Type

export const ColdChainDrillRequestSchema = Schema.Struct({
  deliveryId: Schema.String,
  vehicleId: Schema.String,
  tempC: Schema.Number,
  commandId: Schema.String,
})
export type ColdChainDrillRequest = typeof ColdChainDrillRequestSchema.Type

export const AcceptedResponseSchema = Schema.Struct({ accepted: Schema.Literal(true) })
export type AcceptedResponse = typeof AcceptedResponseSchema.Type

export const HealthResponseSchema = Schema.Struct({ status: Schema.Literal('ok') })
export type HealthResponse = typeof HealthResponseSchema.Type

export const SeedCountsSchema = Schema.Struct({
  tenants: Schema.Number,
  vehicles: Schema.Number,
  deliveries: Schema.Number,
})
export type SeedCounts = typeof SeedCountsSchema.Type

export const SeedResponseSchema = Schema.Struct({
  seeded: Schema.Literal(true),
  ...SeedCountsSchema.fields,
})
export type SeedResponse = typeof SeedResponseSchema.Type
