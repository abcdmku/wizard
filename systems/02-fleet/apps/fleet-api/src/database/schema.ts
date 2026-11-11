import { definePgDurableSchema } from '@openwizard/drizzle/pg'
import type {
  Cargo,
  DeliveryStatus,
  InterventionAction,
  PriorityBand,
  ProcedureItem,
  Severity,
  Traffic,
  VehicleStatus,
  VehicleTelemetry,
  ViewerRole,
} from '@openwizard/fleet-shared'
import {
  bigint,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { Schema } from 'effect'

export const CommandStatusSchema = Schema.Literals(['accepted', 'completed', 'failed'])
export type CommandStatus = typeof CommandStatusSchema.Type

export const RunStatusSchema = Schema.Literals(['active', 'terminal'])
export type RunStatus = typeof RunStatusSchema.Type

export const TerminalStatusSchema = Schema.Literals(['completed', 'cancelled', 'failed'])
export type TerminalStatus = typeof TerminalStatusSchema.Type

export const durableSchema = definePgDurableSchema({ tablePrefix: 'fleet_wizard_' })

export const tenants = pgTable('fleet_tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  cursor: integer('cursor').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const principals = pgTable(
  'fleet_principals',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    bearerToken: text('bearer_token').notNull().unique(),
    role: text('role').$type<ViewerRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    uniqueIndex('fleet_principals_tenant_role_unique').on(table.tenantId, table.role),
  ],
)

export const vehicles = pgTable(
  'fleet_vehicles',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    label: text('label').notNull(),
    driverName: text('driver_name').notNull(),
    status: text('status').$type<VehicleStatus>().notNull(),
    positionX: doublePrecision('position_x').notNull(),
    positionY: doublePrecision('position_y').notNull(),
    heading: doublePrecision('heading').notNull(),
    activeDeliveryId: text('active_delivery_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
)

export const deliveries = pgTable(
  'fleet_deliveries',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    reference: text('reference').notNull(),
    status: text('status').$type<DeliveryStatus>().notNull(),
    customer: text('customer').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    eta: timestamp('eta', { withTimezone: true }).notNull(),
    vehicleId: text('vehicle_id'),
    cargo: jsonb('cargo').$type<Cargo>().notNull(),
    procedure: jsonb('procedure').$type<ReadonlyArray<ProcedureItem>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    foreignKey({
      columns: [table.tenantId, table.vehicleId],
      foreignColumns: [vehicles.tenantId, vehicles.id],
      name: 'fleet_deliveries_vehicle_fk',
    }),
    uniqueIndex('fleet_deliveries_id_unique').on(table.id),
    uniqueIndex('fleet_deliveries_tenant_reference_unique').on(table.tenantId, table.reference),
    index('fleet_deliveries_tenant_status_idx').on(table.tenantId, table.status, table.id),
  ],
)

export const telemetry = pgTable(
  'fleet_telemetry',
  {
    tenantId: text('tenant_id').notNull(),
    vehicleId: text('vehicle_id').notNull(),
    commandId: text('command_id').notNull(),
    capturedAtMs: bigint('captured_at_ms', { mode: 'number' }).notNull(),
    positionX: doublePrecision('position_x').notNull(),
    positionY: doublePrecision('position_y').notNull(),
    heading: doublePrecision('heading').notNull(),
    batteryPercent: doublePrecision('battery_percent').notNull(),
    tempC: doublePrecision('temp_c').notNull(),
    traffic: text('traffic').$type<Traffic>().notNull(),
    fault: jsonb('fault').$type<VehicleTelemetry['fault'] | null>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.vehicleId, table.commandId] }),
    foreignKey({
      columns: [table.tenantId, table.vehicleId],
      foreignColumns: [vehicles.tenantId, vehicles.id],
      name: 'fleet_telemetry_vehicle_fk',
    }).onDelete('cascade'),
    index('fleet_telemetry_vehicle_time_idx').on(
      table.tenantId,
      table.vehicleId,
      table.capturedAtMs,
    ),
  ],
)

export const commands = pgTable(
  'fleet_commands',
  {
    tenantId: text('tenant_id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    commandId: text('command_id').notNull(),
    type: text('command_type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: text('status').$type<CommandStatus>().notNull().default('accepted'),
    occurredAtMs: bigint('occurred_at_ms', { mode: 'number' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.deliveryId, table.commandId] }),
    foreignKey({
      columns: [table.tenantId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
      name: 'fleet_commands_delivery_fk',
    }).onDelete('cascade'),
    index('fleet_commands_delivery_time_idx').on(
      table.tenantId,
      table.deliveryId,
      table.occurredAtMs,
    ),
  ],
)

export const events = pgTable(
  'fleet_events',
  {
    tenantId: text('tenant_id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    eventId: text('event_id').notNull(),
    type: text('event_type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    occurredAtMs: bigint('occurred_at_ms', { mode: 'number' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.deliveryId, table.eventId] }),
    foreignKey({
      columns: [table.tenantId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
      name: 'fleet_events_delivery_fk',
    }).onDelete('cascade'),
    index('fleet_events_delivery_time_idx').on(
      table.tenantId,
      table.deliveryId,
      table.occurredAtMs,
    ),
  ],
)

export const deliveryRuns = pgTable(
  'fleet_delivery_runs',
  {
    tenantId: text('tenant_id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    runKey: text('run_key').notNull().unique(),
    status: text('status').$type<RunStatus>().notNull().default('active'),
    terminalStatus: text('terminal_status').$type<TerminalStatus>(),
    startedAtMs: bigint('started_at_ms', { mode: 'number' }).notNull(),
    terminalAtMs: bigint('terminal_at_ms', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.deliveryId] }),
    foreignKey({
      columns: [table.tenantId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
      name: 'fleet_delivery_runs_delivery_fk',
    }).onDelete('cascade'),
    index('fleet_delivery_runs_active_idx').on(table.status, table.tenantId, table.deliveryId),
  ],
)

export const escalations = pgTable(
  'fleet_escalations',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    score: doublePrecision('score').notNull(),
    band: text('band').$type<PriorityBand>().notNull().default('P3'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    allowedActions: jsonb('allowed_actions').$type<ReadonlyArray<InterventionAction>>().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    foreignKey({
      columns: [table.tenantId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
      name: 'fleet_escalations_delivery_fk',
    }).onDelete('cascade'),
    index('fleet_escalations_open_idx').on(
      table.tenantId,
      table.resolvedAt,
      table.score,
      table.createdAt,
    ),
  ],
)

export const databaseSchema = {
  ...durableSchema,
  commands,
  deliveries,
  deliveryRuns,
  escalations,
  events,
  principals,
  telemetry,
  tenants,
  vehicles,
}
