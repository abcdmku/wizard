import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'
import { durableStoreContract } from '@openwizard/durable/testing'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { expect, it } from 'vitest'
import { createSqliteDrizzleDurableStore } from '../src/sqlite'
import * as schema from './sqlite-schema'

const migrationsFolder = fileURLToPath(new URL('./migrations/sqlite', import.meta.url))

/** A migrated database in its own temp file: libsql rejects `?mode=memory`, and a shared-cache
 * memory database would leak rows between tests. */
async function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'openwizard-sqlite-'))
  const client = createClient({ url: pathToFileURL(join(dir, 'store.db')).href })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return {
    db,
    close() {
      client.close()
      // libsql can keep the file handle open briefly on Windows; a leftover temp dir is harmless.
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
    },
  }
}

durableStoreContract('SQLite Drizzle durable store', async (options) => {
  const { db, close } = await openDatabase()
  return { store: createSqliteDrizzleDurableStore(db, schema.sqliteDurableSchema, options), close }
})

it('does not serialize a request ignored by a pending SQLite claim', async () => {
  const { db, close } = await openDatabase()
  const store = createSqliteDrizzleDurableStore(db, schema.sqliteDurableSchema, {
    now: () => 0,
    leaseTtlMs: 10,
  })

  try {
    const acquired = await store.acquire('sqlite-request-order-run', 'worker-a')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) throw new Error(acquired.code)
    await store.claimDedupe({
      lease: acquired.lease,
      id: 'move-1',
      digest: 'north',
    })
    let calls = 0
    const request = {
      toJSON() {
        calls += 1
        return { call: calls }
      },
    }
    expect(
      await store.claimDedupe({
        lease: acquired.lease,
        id: 'move-1',
        digest: 'north',
        request,
      }),
    ).toMatchObject({ ok: true, status: 'pending' })
    expect(calls).toBe(0)
  } finally {
    close()
  }
})
