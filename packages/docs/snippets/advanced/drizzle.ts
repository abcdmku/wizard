import { createPgDrizzleDurableStore, definePgDurableSchema } from '@openwizard/drizzle/pg'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

/** Export the tables from your Drizzle schema, then generate and run a migration. */
export const workflowTables = definePgDurableSchema({ tablePrefix: 'workflow_' })

/** `db` is your Drizzle database, for example `drizzle(pool)` from `drizzle-orm/node-postgres`. */
export const createStore = (db: PgDatabase<PgQueryResultHKT>) =>
  createPgDrizzleDurableStore(db, workflowTables)
