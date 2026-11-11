import type { PgClient } from '@effect/sql-pg'
import { VehicleTelemetrySchema } from '@openwizard/fleet-shared'
import { Clock, Effect, Option, Schema } from 'effect'
import { SqlSchema } from 'effect/unstable/sql'
import { databaseError } from './errors'
import type {
  AppendCommandInput,
  AppendEventInput,
  MarkRunTerminalInput,
  RecordTelemetryInput,
} from './repository'
import { CommandStatusSchema, TerminalStatusSchema } from './schema'

const TelemetryRequestSchema = Schema.Struct({
  tenantId: Schema.String,
  vehicleId: Schema.String,
  telemetry: VehicleTelemetrySchema,
})
const CommandRequestSchema = Schema.Struct({
  tenantId: Schema.String,
  deliveryId: Schema.String,
  commandId: Schema.String,
  type: Schema.String,
  payload: Schema.fromJsonString(Schema.Unknown),
  status: CommandStatusSchema,
  occurredAtMs: Schema.Number,
})
const EventRequestSchema = Schema.Struct({
  tenantId: Schema.String,
  deliveryId: Schema.String,
  eventId: Schema.String,
  type: Schema.String,
  payload: Schema.fromJsonString(Schema.Unknown),
  occurredAtMs: Schema.Number,
})
const TerminalRequestSchema = Schema.Struct({
  tenantId: Schema.String,
  deliveryId: Schema.String,
  status: TerminalStatusSchema,
  terminalAtMs: Schema.Number,
})
const TenantIdSchema = Schema.Struct({ tenantId: Schema.String })
const TelemetryInsertRowSchema = Schema.Struct({ commandId: Schema.String })
const CommandInsertRowSchema = Schema.Struct({ commandId: Schema.String })
const EventInsertRowSchema = Schema.Struct({ eventId: Schema.String })
const TerminalRowSchema = Schema.Struct({ deliveryId: Schema.String })

export function makeWriteQueries(sql: PgClient.PgClient) {
  const insertTelemetry = SqlSchema.findOneOption({
    Request: TelemetryRequestSchema,
    Result: TelemetryInsertRowSchema,
    execute: ({ tenantId, telemetry, vehicleId }) => sql`
      INSERT INTO fleet_telemetry (
        tenant_id, vehicle_id, command_id, captured_at_ms,
        position_x, position_y, heading, battery_percent,
        temp_c, traffic, fault
      ) VALUES (
        ${tenantId}, ${vehicleId}, ${telemetry.commandId}, ${telemetry.capturedAt},
        ${telemetry.position.x}, ${telemetry.position.y}, ${telemetry.position.heading},
        ${telemetry.batteryPercent}, ${telemetry.tempC}, ${telemetry.traffic},
        ${sql.json(telemetry.fault ?? null)}
      )
      ON CONFLICT (tenant_id, vehicle_id, command_id) DO NOTHING
      RETURNING command_id AS "commandId"
    `,
  })

  const updateTelemetryProjection = SqlSchema.void({
    Request: TelemetryRequestSchema,
    execute: ({ tenantId, telemetry, vehicleId }) =>
      Effect.all(
        [
          sql`
            UPDATE fleet_vehicles
            SET
              position_x = ${telemetry.position.x},
              position_y = ${telemetry.position.y},
              heading = ${telemetry.position.heading},
              updated_at = to_timestamp(${telemetry.capturedAt} / 1000.0)
            WHERE tenant_id = ${tenantId} AND id = ${vehicleId}
          `,
          sql`
            UPDATE fleet_deliveries
            SET
              cargo = jsonb_set(cargo, '{tempC}', to_jsonb(${telemetry.tempC}::double precision), true),
              updated_at = to_timestamp(${telemetry.capturedAt} / 1000.0)
            WHERE tenant_id = ${tenantId} AND vehicle_id = ${vehicleId}
          `,
        ],
        { discard: true },
      ),
  })

  const insertCommand = SqlSchema.findOneOption({
    Request: CommandRequestSchema,
    Result: CommandInsertRowSchema,
    execute: (request) => sql`
      INSERT INTO fleet_commands (
        tenant_id, delivery_id, command_id, command_type,
        payload, status, occurred_at_ms
      ) VALUES (
        ${request.tenantId}, ${request.deliveryId}, ${request.commandId}, ${request.type},
        ${request.payload}::jsonb, ${request.status}, ${request.occurredAtMs}
      )
      ON CONFLICT (tenant_id, delivery_id, command_id) DO NOTHING
      RETURNING command_id AS "commandId"
    `,
  })

  const insertEvent = SqlSchema.findOneOption({
    Request: EventRequestSchema,
    Result: EventInsertRowSchema,
    execute: (request) => sql`
      INSERT INTO fleet_events (
        tenant_id, delivery_id, event_id, event_type, payload, occurred_at_ms
      ) VALUES (
        ${request.tenantId}, ${request.deliveryId}, ${request.eventId}, ${request.type},
        ${request.payload}::jsonb, ${request.occurredAtMs}
      )
      ON CONFLICT (tenant_id, delivery_id, event_id) DO NOTHING
      RETURNING event_id AS "eventId"
    `,
  })

  const updateRunTerminal = SqlSchema.findOneOption({
    Request: TerminalRequestSchema,
    Result: TerminalRowSchema,
    execute: (request) => sql`
      UPDATE fleet_delivery_runs
      SET
        status = 'terminal',
        terminal_status = ${request.status},
        terminal_at_ms = ${request.terminalAtMs}
      WHERE
        tenant_id = ${request.tenantId}
        AND delivery_id = ${request.deliveryId}
        AND status = 'active'
      RETURNING delivery_id AS "deliveryId"
    `,
  })

  const updateTerminalProjection = SqlSchema.void({
    Request: TerminalRequestSchema,
    execute: (request) =>
      Effect.gen(function* () {
        if (request.status !== 'failed') {
          yield* sql`
            UPDATE fleet_deliveries
            SET
              status = ${request.status},
              updated_at = to_timestamp(${request.terminalAtMs} / 1000.0)
            WHERE tenant_id = ${request.tenantId} AND id = ${request.deliveryId}
          `
        }
        yield* Effect.all(
          [
            sql`
              UPDATE fleet_vehicles
              SET
                status = 'available',
                active_delivery_id = NULL,
                updated_at = to_timestamp(${request.terminalAtMs} / 1000.0)
              WHERE tenant_id = ${request.tenantId} AND active_delivery_id = ${request.deliveryId}
            `,
            sql`
              UPDATE fleet_escalations
              SET resolved_at = to_timestamp(${request.terminalAtMs} / 1000.0)
              WHERE
                tenant_id = ${request.tenantId}
                AND delivery_id = ${request.deliveryId}
                AND resolved_at IS NULL
            `,
          ],
          { discard: true },
        )
      }),
  })

  const incrementCursor = SqlSchema.void({
    Request: TenantIdSchema,
    execute: ({ tenantId }) => sql`
      UPDATE fleet_tenants SET cursor = cursor + 1 WHERE id = ${tenantId}
    `,
  })

  const recordTelemetry = (input: RecordTelemetryInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const inserted = yield* insertTelemetry(input)
          if (Option.isNone(inserted)) return
          yield* updateTelemetryProjection(input)
          yield* incrementCursor({ tenantId: input.tenantId })
        }),
      )
      .pipe(Effect.mapError(databaseError('recordTelemetry')))

  const appendCommand = (input: AppendCommandInput) =>
    Effect.gen(function* () {
      const occurredAtMs = input.occurredAtMs ?? (yield* Clock.currentTimeMillis)
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const inserted = yield* insertCommand({
            ...input,
            status: input.status ?? 'accepted',
            occurredAtMs,
          })
          if (Option.isNone(inserted)) return false
          yield* incrementCursor({ tenantId: input.tenantId })
          return true
        }),
      )
    }).pipe(Effect.mapError(databaseError('appendCommand')))

  const appendEvent = (input: AppendEventInput) =>
    Effect.gen(function* () {
      const occurredAtMs = input.occurredAtMs ?? (yield* Clock.currentTimeMillis)
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const inserted = yield* insertEvent({ ...input, occurredAtMs })
          if (Option.isNone(inserted)) return false
          yield* incrementCursor({ tenantId: input.tenantId })
          return true
        }),
      )
    }).pipe(Effect.mapError(databaseError('appendEvent')))

  const markRunTerminal = (input: MarkRunTerminalInput) =>
    Effect.gen(function* () {
      const terminalAtMs = input.terminalAtMs ?? (yield* Clock.currentTimeMillis)
      const request = { ...input, terminalAtMs }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const updated = yield* updateRunTerminal(request)
          if (Option.isNone(updated)) return
          yield* updateTerminalProjection(request)
          yield* incrementCursor({ tenantId: input.tenantId })
        }),
      )
    }).pipe(Effect.mapError(databaseError('markRunTerminal')))

  return { recordTelemetry, appendCommand, appendEvent, markRunTerminal }
}
