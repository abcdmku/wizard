import type { PgClient } from '@effect/sql-pg'
import type { Dashboard } from '@openwizard/fleet-shared'
import { Clock, Effect, Option, Schema } from 'effect'
import { SqlSchema } from 'effect/unstable/sql'
import { databaseError, type FleetDatabaseError } from './errors'
import {
  ActiveRunRowSchema,
  DeliveryOwnerRowSchema,
  DeliveryRowSchema,
  deliveryFromRow,
  EscalationRowSchema,
  escalationFromRow,
  TenantAuthRowSchema,
  TenantRowSchema,
  VehicleRowSchema,
  vehicleFromRow,
} from './models'

const TenantIdSchema = Schema.Struct({ tenantId: Schema.String })
const TokenSchema = Schema.Struct({ token: Schema.String })
const DeliveryLookupSchema = Schema.Struct({ tenantId: Schema.String, deliveryId: Schema.String })

export function makeReadQueries(sql: PgClient.PgClient) {
  const findTenantByTokenQuery = SqlSchema.findOneOption({
    Request: TokenSchema,
    Result: TenantAuthRowSchema,
    execute: ({ token }) => sql`
      SELECT tenant_id AS "tenantId", role
      FROM fleet_principals
      WHERE bearer_token = ${token}
      LIMIT 1
    `,
  })

  const tenantQuery = SqlSchema.findOne({
    Request: TenantIdSchema,
    Result: TenantRowSchema,
    execute: ({ tenantId }) => sql`
      SELECT id, name, timezone, cursor
      FROM fleet_tenants
      WHERE id = ${tenantId}
      LIMIT 1
    `,
  })

  const vehiclesQuery = SqlSchema.findAll({
    Request: TenantIdSchema,
    Result: VehicleRowSchema,
    execute: ({ tenantId }) => sql`
      SELECT
        id,
        label,
        driver_name AS "driverName",
        status,
        json_build_object(
          'x', position_x,
          'y', position_y,
          'heading', heading
        ) AS position,
        active_delivery_id AS "activeDeliveryId",
        to_char(
          updated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS "updatedAt"
      FROM fleet_vehicles
      WHERE tenant_id = ${tenantId}
      ORDER BY id
    `,
  })

  const deliveriesQuery = SqlSchema.findAll({
    Request: TenantIdSchema,
    Result: DeliveryRowSchema,
    execute: ({ tenantId }) => sql`
      SELECT
        id,
        reference,
        status,
        customer,
        origin,
        destination,
        to_char(
          eta AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS eta,
        vehicle_id AS "vehicleId",
        cargo,
        procedure
      FROM fleet_deliveries
      WHERE tenant_id = ${tenantId}
      ORDER BY reference
    `,
  })

  const escalationsQuery = SqlSchema.findAll({
    Request: TenantIdSchema,
    Result: EscalationRowSchema,
    execute: ({ tenantId }) => sql`
      SELECT
        id,
        delivery_id AS "deliveryId",
        kind,
        severity,
        score,
        band,
        to_char(
          created_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS "createdAt",
        title,
        detail,
        allowed_actions AS "allowedActions"
      FROM fleet_escalations
      WHERE tenant_id = ${tenantId} AND resolved_at IS NULL
      ORDER BY score DESC, created_at, id
    `,
  })

  const findDeliveryOwnerQuery = SqlSchema.findOneOption({
    Request: DeliveryLookupSchema,
    Result: DeliveryOwnerRowSchema,
    execute: ({ deliveryId, tenantId }) => sql`
      SELECT tenant_id AS "tenantId"
      FROM fleet_deliveries
      WHERE id = ${deliveryId}
      ORDER BY (tenant_id = ${tenantId}) DESC
      LIMIT 1
    `,
  })

  const listActiveRunsQuery = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ActiveRunRowSchema,
    execute: () => sql`
      SELECT tenant_id AS "tenantId", delivery_id AS "deliveryId"
      FROM fleet_delivery_runs
      WHERE status = 'active'
      ORDER BY tenant_id, delivery_id
    `,
  })

  const findTenantByToken = (token: string) =>
    findTenantByTokenQuery({ token }).pipe(Effect.mapError(databaseError('findTenantByToken')))

  const getDashboard = (tenantId: string): Effect.Effect<Dashboard, FleetDatabaseError> =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis
      const [tenant, vehicleRows, deliveryRows, escalationRows] = yield* Effect.all(
        [
          tenantQuery({ tenantId }),
          vehiclesQuery({ tenantId }),
          deliveriesQuery({ tenantId }),
          escalationsQuery({ tenantId }),
        ],
        { concurrency: 4 },
      )
      return {
        tenant: { id: tenant.id, name: tenant.name, timezone: tenant.timezone },
        generatedAt: new Date(nowMs).toISOString(),
        cursor: tenant.cursor,
        vehicles: vehicleRows.map(vehicleFromRow),
        deliveries: deliveryRows.map(deliveryFromRow),
        escalations: escalationRows.map(escalationFromRow),
      }
    }).pipe(Effect.mapError(databaseError('getDashboard')))

  const findDeliveryOwner = (tenantId: string, deliveryId: string) =>
    findDeliveryOwnerQuery({ tenantId, deliveryId }).pipe(
      Effect.map(Option.map((row) => row.tenantId)),
      Effect.mapError(databaseError('findDeliveryOwner')),
    )

  const listActiveRuns = () =>
    listActiveRunsQuery(undefined).pipe(Effect.mapError(databaseError('listActiveRuns')))

  return { findTenantByToken, getDashboard, findDeliveryOwner, listActiveRuns }
}
