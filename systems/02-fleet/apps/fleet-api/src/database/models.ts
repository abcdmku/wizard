import {
  CargoSchema,
  type Delivery,
  DeliveryStatusSchema,
  type Escalation,
  InterventionActionSchema,
  PriorityBandSchema,
  ProcedureItemSchema,
  SeveritySchema,
  type Vehicle,
  VehicleStatusSchema,
  ViewerRoleSchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'

const NullableStringSchema = Schema.NullOr(Schema.String)

export const TenantRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  timezone: Schema.String,
  cursor: Schema.Number,
})
export type TenantRow = typeof TenantRowSchema.Type

export const TenantAuthRowSchema = Schema.Struct({
  tenantId: Schema.String,
  role: ViewerRoleSchema,
})
export type TenantAuth = typeof TenantAuthRowSchema.Type

export const VehicleRowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  driverName: Schema.String,
  status: VehicleStatusSchema,
  position: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    heading: Schema.Number,
  }),
  activeDeliveryId: NullableStringSchema,
  updatedAt: Schema.String,
})
export type VehicleRow = typeof VehicleRowSchema.Type

export const DeliveryRowSchema = Schema.Struct({
  id: Schema.String,
  reference: Schema.String,
  status: DeliveryStatusSchema,
  customer: Schema.String,
  origin: Schema.String,
  destination: Schema.String,
  eta: Schema.String,
  vehicleId: NullableStringSchema,
  cargo: CargoSchema,
  procedure: Schema.Array(ProcedureItemSchema),
})
export type DeliveryRow = typeof DeliveryRowSchema.Type

export const EscalationRowSchema = Schema.Struct({
  id: Schema.String,
  deliveryId: Schema.String,
  kind: Schema.String,
  severity: SeveritySchema,
  score: Schema.Number,
  band: PriorityBandSchema,
  createdAt: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  allowedActions: Schema.Array(InterventionActionSchema),
})

export const DeliveryOwnerRowSchema = Schema.Struct({ tenantId: Schema.String })
export const ActiveRunRowSchema = Schema.Struct({
  tenantId: Schema.String,
  deliveryId: Schema.String,
})
export type ActiveRunIdentity = typeof ActiveRunRowSchema.Type

export function vehicleFromRow(row: VehicleRow): Vehicle {
  const vehicle = {
    id: row.id,
    label: row.label,
    driverName: row.driverName,
    status: row.status,
    position: row.position,
    updatedAt: row.updatedAt,
  }
  return row.activeDeliveryId === null
    ? vehicle
    : { ...vehicle, activeDeliveryId: row.activeDeliveryId }
}

export function deliveryFromRow(row: DeliveryRow): Delivery {
  const delivery = {
    id: row.id,
    reference: row.reference,
    status: row.status,
    customer: row.customer,
    origin: row.origin,
    destination: row.destination,
    eta: row.eta,
    cargo: row.cargo,
    procedure: row.procedure,
  }
  return row.vehicleId === null ? delivery : { ...delivery, vehicleId: row.vehicleId }
}

export function escalationFromRow(row: typeof EscalationRowSchema.Type): Escalation {
  return row
}
