import { createPgDrizzleDurableStore } from '@openwizard/drizzle/pg'
import type { DurableStore } from '@openwizard/durable/store'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { databaseSchema, durableSchema } from './schema'

export type FleetDrizzleDatabase = NodePgDatabase<typeof databaseSchema>

export function createFleetDrizzleDatabase(pool: Pool): FleetDrizzleDatabase {
  return drizzle(pool, { schema: databaseSchema })
}

export function createFleetDurableStore(database: FleetDrizzleDatabase): DurableStore {
  // dx-audit: as-unknown -- pnpm binds the app and workspace adapter to separate Drizzle peers.
  const durableDatabase = database as unknown as Parameters<typeof createPgDrizzleDurableStore>[0]
  return createPgDrizzleDurableStore(durableDatabase, durableSchema)
}
