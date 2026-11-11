import type { PgClient } from '@effect/sql-pg'
import { SeedCountsSchema } from '@openwizard/fleet-shared'
import { Effect } from 'effect'
import { SqlSchema } from 'effect/unstable/sql'
import { deliveryRunKey } from '../runtime-open'
import { type FleetSeedData, FleetSeedDataSchema } from '../seed-data'
import { databaseError } from './errors'

export function makeSeed(sql: PgClient.PgClient) {
  const seedQuery = SqlSchema.void({
    Request: FleetSeedDataSchema,
    execute: (data) =>
      sql.withTransaction(
        Effect.gen(function* () {
          yield* Effect.forEach(
            data.tenants,
            (tenant) => sql`
              INSERT INTO fleet_tenants (id, name, timezone, cursor)
              VALUES (${tenant.id}, ${tenant.name}, ${tenant.timezone}, 1)
              ON CONFLICT (id) DO UPDATE
              SET name = EXCLUDED.name, timezone = EXCLUDED.timezone
            `,
            { discard: true },
          )

          yield* Effect.forEach(
            data.tokens,
            (principal) => sql`
              INSERT INTO fleet_principals (tenant_id, id, bearer_token, role)
              VALUES (
                ${principal.viewer.tenantId}, ${principal.id},
                ${principal.token}, ${principal.viewer.role}
              )
              ON CONFLICT (tenant_id, id) DO UPDATE
              SET bearer_token = EXCLUDED.bearer_token, role = EXCLUDED.role
            `,
            { discard: true },
          )

          yield* Effect.forEach(
            data.vehicles,
            ({ tenantId, vehicle }) => sql`
              INSERT INTO fleet_vehicles (
                tenant_id, id, label, driver_name, status,
                position_x, position_y, heading, active_delivery_id, updated_at
              ) VALUES (
                ${tenantId}, ${vehicle.id}, ${vehicle.label}, ${vehicle.driverName}, ${vehicle.status},
                ${vehicle.position.x}, ${vehicle.position.y}, ${vehicle.position.heading}, NULL,
                ${vehicle.updatedAt}::timestamptz
              )
              ON CONFLICT (tenant_id, id) DO NOTHING
            `,
            { discard: true },
          )

          yield* Effect.forEach(
            data.deliveries,
            ({ delivery, tenantId }) => sql`
              INSERT INTO fleet_deliveries (
                tenant_id, id, reference, status, customer, origin,
                destination, eta, vehicle_id, cargo, procedure
              ) VALUES (
                ${tenantId}, ${delivery.id}, ${delivery.reference}, ${delivery.status},
                ${delivery.customer}, ${delivery.origin}, ${delivery.destination},
                ${delivery.eta}::timestamptz, ${delivery.vehicleId ?? null},
                ${JSON.stringify(delivery.cargo)}::jsonb,
                ${JSON.stringify(delivery.procedure)}::jsonb
              )
              ON CONFLICT (tenant_id, id) DO NOTHING
            `,
            { discard: true },
          )

          yield* Effect.forEach(
            data.vehicles,
            ({ tenantId, vehicle }) =>
              vehicle.activeDeliveryId === undefined
                ? Effect.void
                : Effect.asVoid(sql`
                  UPDATE fleet_vehicles
                  SET active_delivery_id = ${vehicle.activeDeliveryId}
                  WHERE
                    fleet_vehicles.tenant_id = ${tenantId}
                    AND fleet_vehicles.id = ${vehicle.id}
                    AND fleet_vehicles.active_delivery_id IS NULL
                    AND EXISTS (
                      SELECT 1
                      FROM fleet_deliveries
                      WHERE
                        fleet_deliveries.tenant_id = ${tenantId}
                        AND fleet_deliveries.id = ${vehicle.activeDeliveryId}
                        AND fleet_deliveries.status NOT IN ('completed', 'cancelled')
                    )
                `),
            { discard: true },
          )

          yield* Effect.forEach(
            data.deliveries,
            ({ delivery, tenantId }) => sql`
              INSERT INTO fleet_delivery_runs (
                tenant_id, delivery_id, run_key, status, started_at_ms
              ) VALUES (
                ${tenantId}, ${delivery.id},
                ${deliveryRunKey(tenantId, delivery.id)}, 'active',
                (extract(epoch FROM ${delivery.procedure[0]?.timestamp ?? delivery.eta}::timestamptz) * 1000)::bigint
              )
              ON CONFLICT (tenant_id, delivery_id) DO NOTHING
            `,
            { discard: true },
          )

          yield* sql`
            INSERT INTO fleet_escalations (
              tenant_id, id, delivery_id, kind, severity, score, band,
              created_at, title, detail, allowed_actions
            ) VALUES (
              'tenant-lakeshore', 'escalation-1', 'delivery-1',
              'cold_chain_temperature', 'critical', 10, 'P0',
              '2026-01-15T14:00:00.000Z'::timestamptz,
              'Cold-chain temperature excursion',
              'The delivery needs dispatcher review before handoff.',
              '["contact_driver", "hold", "cancel"]'::jsonb
            )
            ON CONFLICT (tenant_id, id) DO NOTHING
          `
        }),
      ),
  })

  return (data: FleetSeedData) =>
    seedQuery(data).pipe(
      Effect.as(
        SeedCountsSchema.make({
          tenants: data.tenants.length,
          vehicles: data.vehicles.length,
          deliveries: data.deliveries.length,
        }),
      ),
      Effect.mapError(databaseError('seed')),
    )
}
