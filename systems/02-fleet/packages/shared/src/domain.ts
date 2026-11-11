import { Schema } from 'effect'

export const SeveritySchema = Schema.Literals(['low', 'medium', 'high', 'critical'])
export type Severity = typeof SeveritySchema.Type

export const PriorityBandSchema = Schema.Literals(['P3', 'P2', 'P1', 'P0'])
export type PriorityBand = typeof PriorityBandSchema.Type

export const ViewerRoleSchema = Schema.Literals(['dispatcher', 'manager', 'simulator', 'seed'])
export type ViewerRole = typeof ViewerRoleSchema.Type

export const VehicleStatusSchema = Schema.Literals(['available', 'en_route', 'delayed', 'offline'])
export type VehicleStatus = typeof VehicleStatusSchema.Type

export const DeliveryStatusSchema = Schema.Literals([
  'pending',
  'in_transit',
  'delayed',
  'completed',
  'cancelled',
])
export type DeliveryStatus = typeof DeliveryStatusSchema.Type

export const ProcedureItemStatusSchema = Schema.Literals([
  'complete',
  'active',
  'pending',
  'blocked',
])
export type ProcedureItemStatus = typeof ProcedureItemStatusSchema.Type

export const InterventionActionSchema = Schema.Literals([
  'contact_driver',
  'reroute',
  'hold',
  'cancel',
  'complete',
])
export type InterventionAction = typeof InterventionActionSchema.Type

export const TenantSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  timezone: Schema.String,
})
export type Tenant = typeof TenantSchema.Type

export const ViewerSchema = Schema.Struct({
  tenantId: Schema.String,
  role: ViewerRoleSchema,
})
export type Viewer = typeof ViewerSchema.Type

export const DurableVersionSchema = Schema.Struct({
  epoch: Schema.Number,
  seq: Schema.Number,
})
export type DurableVersion = typeof DurableVersionSchema.Type

export const PositionSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  heading: Schema.Number,
})
export type Position = typeof PositionSchema.Type

export const VehicleSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  driverName: Schema.String,
  status: VehicleStatusSchema,
  position: PositionSchema,
  activeDeliveryId: Schema.optional(Schema.String),
  updatedAt: Schema.String,
})
export type Vehicle = typeof VehicleSchema.Type

export const CargoSchema = Schema.Struct({
  label: Schema.String,
  coldChain: Schema.Boolean,
  tempC: Schema.optional(Schema.Number),
  minC: Schema.optional(Schema.Number),
  maxC: Schema.optional(Schema.Number),
})
export type Cargo = typeof CargoSchema.Type

export const ProcedureItemSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  status: ProcedureItemStatusSchema,
  timestamp: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
})
export type ProcedureItem = typeof ProcedureItemSchema.Type

export const DeliverySchema = Schema.Struct({
  id: Schema.String,
  reference: Schema.String,
  version: Schema.optional(DurableVersionSchema),
  status: DeliveryStatusSchema,
  customer: Schema.String,
  origin: Schema.String,
  destination: Schema.String,
  eta: Schema.String,
  vehicleId: Schema.optional(Schema.String),
  cargo: CargoSchema,
  procedure: Schema.Array(ProcedureItemSchema),
})
export type Delivery = typeof DeliverySchema.Type

export const EscalationSchema = Schema.Struct({
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
export type Escalation = typeof EscalationSchema.Type

export const DashboardSchema = Schema.Struct({
  tenant: TenantSchema,
  generatedAt: Schema.String,
  cursor: Schema.Number,
  vehicles: Schema.Array(VehicleSchema),
  deliveries: Schema.Array(DeliverySchema),
  escalations: Schema.Array(EscalationSchema),
})
export type Dashboard = typeof DashboardSchema.Type

export const LiveDispatchEventSchema = Schema.Struct({
  cursor: Schema.Number,
  type: Schema.Literal('snapshot'),
  data: DashboardSchema,
})
export type LiveDispatchEvent = typeof LiveDispatchEventSchema.Type
