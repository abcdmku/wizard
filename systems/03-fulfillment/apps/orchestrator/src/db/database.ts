import { createPgDrizzleDurableStore } from '@openwizard/drizzle/pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { migrate } from './migrate'
import { durableSchema } from './schema'

export async function createDatabase(
  connectionString: string,
  options: { readonly leaseTtlMs: number; readonly timerClaimTtlMs: number },
) {
  const pool = new Pool({ connectionString, max: 10 })
  await migrate(pool)
  const db = drizzle(pool)
  const durableStore = createPgDrizzleDurableStore(db, durableSchema, {
    leaseTtlMs: options.leaseTtlMs,
    timerClaimTtlMs: options.timerClaimTtlMs,
  })
  return { pool, durableStore }
}
