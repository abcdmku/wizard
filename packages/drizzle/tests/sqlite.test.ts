import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { createSqliteDrizzleDurableStore } from '../src/sqlite'
import { durableStoreContract } from './contract'
import * as schema from './sqlite-schema'

const migrationsFolder = fileURLToPath(new URL('./migrations/sqlite', import.meta.url))

durableStoreContract('SQLite Drizzle durable store', async () => {
  let now = Number.MAX_SAFE_INTEGER
  const client = createClient({ url: 'file::memory:?cache=shared' })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  const store = createSqliteDrizzleDurableStore(db, schema.sqliteDurableSchema, {
    now: () => now,
    leaseTtlMs: 10,
    timerClaimTtlMs: 5,
    retention: { completedDedupeMs: 5, timerClaimMs: 0 },
  })
  await store.sweep()
  now = 0
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
