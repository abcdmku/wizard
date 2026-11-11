import { PgClient } from '@effect/sql-pg'
import type { DurableStore } from '@openwizard/durable/store'
import { Context, Effect, Layer } from 'effect'
import { Pool } from 'pg'
import {
  createFleetDrizzleDatabase,
  createFleetDurableStore,
  type FleetDrizzleDatabase,
} from './durable'
import { FleetRepositoryLive } from './repository-live'

export interface FleetDatabaseOptions {
  readonly connectionString: string
  readonly maxConnections?: number
  readonly idleTimeoutMillis?: number
  readonly connectionTimeoutMillis?: number
}

export interface FleetDatabaseShape {
  readonly pool: Pool
  readonly drizzle: FleetDrizzleDatabase
  readonly durableStore: DurableStore
}

export class FleetDatabase extends Context.Service<FleetDatabase, FleetDatabaseShape>()(
  'fleet/database/FleetDatabase',
) {}

export class FleetDurableStore extends Context.Service<FleetDurableStore, DurableStore>()(
  'fleet/database/FleetDurableStore',
) {}

export function makeFleetDatabaseLayer(options: FleetDatabaseOptions): Layer.Layer<FleetDatabase> {
  return Layer.effect(
    FleetDatabase,
    Effect.acquireRelease(
      Effect.sync(() => {
        const pool = new Pool({
          connectionString: options.connectionString,
          ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
          ...(options.idleTimeoutMillis === undefined
            ? {}
            : { idleTimeoutMillis: options.idleTimeoutMillis }),
          ...(options.connectionTimeoutMillis === undefined
            ? {}
            : { connectionTimeoutMillis: options.connectionTimeoutMillis }),
        })
        const drizzle = createFleetDrizzleDatabase(pool)
        return FleetDatabase.of({
          pool,
          drizzle,
          durableStore: createFleetDurableStore(drizzle),
        })
      }),
      (database) => Effect.promise(() => database.pool.end()),
    ),
  )
}

export const FleetPgClientLive = PgClient.layerFrom(
  Effect.gen(function* () {
    const database = yield* FleetDatabase
    return yield* PgClient.fromPool({
      acquire: Effect.succeed(database.pool),
      applicationName: 'openwizard-fleet-api',
    })
  }),
)

export const FleetDurableStoreLive = Layer.effect(
  FleetDurableStore,
  Effect.map(FleetDatabase, (database) => database.durableStore),
)

export function makeFleetDatabaseLive(options: FleetDatabaseOptions) {
  const database = makeFleetDatabaseLayer(options)
  const infrastructure = Layer.merge(FleetPgClientLive, FleetDurableStoreLive).pipe(
    Layer.provideMerge(database),
  )
  return FleetRepositoryLive.pipe(Layer.provideMerge(infrastructure))
}
