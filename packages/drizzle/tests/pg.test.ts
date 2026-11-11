import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { durableStoreContract } from '@openwizard/durable/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { expect, it } from 'vitest'
import { createPgDrizzleDurableStore } from '../src/pg'
import * as schema from './pg-schema'

const migrationsFolder = fileURLToPath(new URL('./migrations/pg', import.meta.url))

durableStoreContract('PostgreSQL Drizzle durable store', async (options) => {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return {
    store: createPgDrizzleDurableStore(db, schema.pgDurableSchema, options),
    close: () => client.close(),
  }
})

it('commits a snapshot with one PostgreSQL statement', async () => {
  const queries: string[] = []
  const client = new PGlite()
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (query) => queries.push(query) },
  })
  await migrate(db, { migrationsFolder })
  const store = createPgDrizzleDurableStore(db, schema.pgDurableSchema, {
    now: () => 0,
    leaseTtlMs: 10,
  })

  try {
    const acquired = await store.acquire('fast-commit-run', 'worker-a')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) throw new Error(acquired.code)
    await store.commit({
      lease: acquired.lease,
      expected: null,
      next: { value: { tick: 0 }, version: { epoch: 0, seq: 0 } },
    })

    queries.length = 0
    expect(
      await store.commit({
        lease: acquired.lease,
        expected: { epoch: 0, seq: 0 },
        next: { value: { tick: 1 }, version: { epoch: 0, seq: 1 } },
      }),
    ).toEqual({ ok: true, version: { epoch: 0, seq: 1 } })
    expect(queries).toHaveLength(1)
    expect(queries[0]?.trimStart().toLowerCase()).toMatch(/^update /)
  } finally {
    await client.close()
  }
})

it('claims a fresh dedupe id with one PostgreSQL statement', async () => {
  const queries: string[] = []
  const client = new PGlite()
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (query) => queries.push(query) },
  })
  await migrate(db, { migrationsFolder })
  const store = createPgDrizzleDurableStore(db, schema.pgDurableSchema, {
    now: () => 0,
    leaseTtlMs: 10,
  })

  try {
    const acquired = await store.acquire('fast-claim-run', 'worker-a')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) throw new Error(acquired.code)

    queries.length = 0
    expect(
      await store.claimDedupe({
        lease: acquired.lease,
        id: 'command-1',
        digest: 'request-1',
        request: { move: 'north' },
      }),
    ).toEqual({
      ok: true,
      status: 'claimed',
      claimId: 'dedupe:1',
      request: { move: 'north' },
    })
    expect(queries).toHaveLength(1)
    expect(queries[0]?.toLowerCase()).toContain('for update')
  } finally {
    await client.close()
  }
})

it('completes a dedupe claim with one PostgreSQL statement', async () => {
  const queries: string[] = []
  const client = new PGlite()
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (query) => queries.push(query) },
  })
  await migrate(db, { migrationsFolder })
  const store = createPgDrizzleDurableStore(db, schema.pgDurableSchema, {
    now: () => 0,
    leaseTtlMs: 10,
  })

  try {
    const acquired = await store.acquire('fast-completion-run', 'worker-a')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) throw new Error(acquired.code)
    const version = { epoch: 0, seq: 0 }
    await store.commit({
      lease: acquired.lease,
      expected: null,
      next: { value: { tick: 0 }, version },
    })
    const claim = await store.claimDedupe({
      lease: acquired.lease,
      id: 'command-1',
      digest: 'request-1',
    })
    expect(claim).toMatchObject({ ok: true, status: 'claimed' })
    if (!claim.ok || claim.status !== 'claimed') throw new Error('dedupe claim failed')

    queries.length = 0
    expect(
      await store.commit({
        lease: acquired.lease,
        expected: version,
        completeDedupe: {
          id: 'command-1',
          digest: 'request-1',
          claimId: claim.claimId,
          result: { accepted: true },
        },
      }),
    ).toEqual({ ok: true, version })
    expect(queries).toHaveLength(1)
    const returning = queries[0]?.toLowerCase().split(' returning ')[1]
    expect(returning).toBe('"test_wizard_dedupe"."run_key"')
  } finally {
    await client.close()
  }
})
