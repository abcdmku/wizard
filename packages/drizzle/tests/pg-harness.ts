import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createPgDrizzleDurableStore } from '../src/pg'
import * as schema from './pg-schema'

const migrationsFolder = fileURLToPath(new URL('./migrations/pg', import.meta.url))

export async function createPgHarness() {
  let now = 0
  const queries: string[] = []
  const client = new PGlite()
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (query) => queries.push(query) },
  })
  await migrate(db, { migrationsFolder })
  const store = createPgDrizzleDurableStore(db, schema.pgDurableSchema, {
    now: () => now,
    leaseTtlMs: 10,
    timerClaimTtlMs: 5,
  })
  return {
    client,
    db,
    queries,
    store,
    advance(milliseconds: number) {
      now += milliseconds
    },
  }
}
