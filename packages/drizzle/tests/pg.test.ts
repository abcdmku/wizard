import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createPgDrizzleDurableStore } from '../src/pg'
import { durableStoreContract } from './contract'
import * as schema from './pg-schema'

const migrationsFolder = fileURLToPath(new URL('./migrations/pg', import.meta.url))

durableStoreContract('PostgreSQL Drizzle durable store', async () => {
  let now = 0
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  const store = createPgDrizzleDurableStore(db, schema.pgDurableSchema, {
    now: () => now,
    leaseTtlMs: 10,
    timerClaimTtlMs: 5,
    retention: { completedDedupeMs: 5, timerClaimMs: 0 },
  })
  return {
    store,
    advance(milliseconds: number) {
      now += milliseconds
    },
    async close() {
      await client.close()
    },
  }
})
