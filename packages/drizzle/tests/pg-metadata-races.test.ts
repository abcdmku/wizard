import type { DurableStore, Lease, Version } from '@openwizard/durable/store'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgHarness } from './pg-harness'
import * as schema from './pg-schema'

const openClients: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()))
})

describe('PostgreSQL metadata fast-path races', () => {
  it('linearizes completion-only commits against snapshot CAS', async () => {
    const harness = await createHarness()
    const lease = await acquire(harness.store, 'completion-cas-run')
    const initial: Version = { epoch: 0, seq: 0 }
    const current: Version = { epoch: 0, seq: 1 }
    await commitSnapshot(harness.store, lease, null, initial)
    const claim = await claimDedupe(harness.store, lease, 'move-1')

    const [snapshotResult, completionResult] = await Promise.all([
      harness.store.commit({
        lease,
        expected: initial,
        next: { value: { tick: 1 }, version: current },
      }),
      harness.store.commit({
        lease,
        expected: initial,
        completeDedupe: completion(claim.claimId, { tick: 0 }),
      }),
    ])
    expect(snapshotResult).toEqual({ ok: true, version: current })
    expect([
      { ok: true, version: initial },
      { ok: false, code: 'CAS_CONFLICT', actual: current },
    ]).toContainEqual(completionResult)

    if (!completionResult.ok) {
      expect(await harness.store.claimDedupe(claimInput(lease, 'move-1'))).toMatchObject({
        ok: true,
        status: 'pending',
        claimId: claim.claimId,
      })
      expect(
        await harness.store.commit({
          lease,
          expected: current,
          completeDedupe: completion(claim.claimId, { tick: 0 }),
        }),
      ).toEqual({ ok: true, version: current })
    }
    expect(await harness.store.claimDedupe(claimInput(lease, 'move-1'))).toEqual({
      ok: true,
      status: 'completed',
      digest: 'north',
      result: { tick: 0 },
    })
  })

  it('rejects every mismatched completion field without completing the claim', async () => {
    const harness = await createHarness()
    const lease = await acquire(harness.store, 'completion-fields-run')
    const claim = await claimDedupe(harness.store, lease, 'move-1')
    const base = completion(claim.claimId, 'done')
    const mismatches = [
      { ...base, id: 'move-2' },
      { ...base, digest: 'south' },
      { ...base, claimId: 'dedupe:999' },
    ]
    for (const completeDedupe of mismatches) {
      expect(await harness.store.commit({ lease, expected: null, completeDedupe })).toEqual({
        ok: false,
        code: 'DEDUPLICATE_CONFLICT',
      })
    }
    expect(await harness.store.claimDedupe(claimInput(lease, 'move-1'))).toMatchObject({
      ok: true,
      status: 'pending',
      claimId: claim.claimId,
    })
    expect(await harness.store.commit({ lease, expected: null, completeDedupe: base })).toEqual({
      ok: true,
      version: null,
    })
  })

  it('does not mutate a claim or counter when JSON serialization fails', async () => {
    const harness = await createHarness()
    const lease = await acquire(harness.store, 'serialization-run')
    const circular: { self?: unknown } = {}
    circular.self = circular

    await expect(
      harness.store.claimDedupe({
        lease,
        id: 'bad-request',
        digest: 'bad-request',
        request: circular,
      }),
    ).rejects.toMatchObject({ code: 'NOT_SERIALIZABLE' })
    const claim = await claimDedupe(harness.store, lease, 'move-1')
    expect(claim.claimId).toBe('dedupe:1')
    expect(
      await harness.store.claimDedupe({ ...claimInput(lease, 'move-1'), request: circular }),
    ).toMatchObject({ ok: true, status: 'pending', claimId: claim.claimId })
    await expect(
      harness.store.commit({
        lease,
        expected: null,
        completeDedupe: completion(claim.claimId, circular),
      }),
    ).rejects.toMatchObject({ code: 'NOT_SERIALIZABLE' })
    expect(await harness.store.claimDedupe(claimInput(lease, 'move-1'))).toMatchObject({
      ok: true,
      status: 'pending',
      claimId: claim.claimId,
    })
    expect(
      await harness.store.commit({
        lease,
        expected: null,
        completeDedupe: completion(claim.claimId, 'done'),
      }),
    ).toEqual({ ok: true, version: null })
    expect(
      await harness.store.claimDedupe({ ...claimInput(lease, 'move-1'), request: circular }),
    ).toEqual({ ok: true, status: 'completed', digest: 'north', result: 'done' })
  })

  it('classifies an exhausted claim counter through the locked fallback', async () => {
    const harness = await createHarness()
    const lease = await acquire(harness.store, 'counter-exhausted-run')
    await harness.db
      .update(schema.runs)
      .set({ claimCounter: Number.MAX_SAFE_INTEGER })
      .where(eq(schema.runs.key, lease.key))

    await expect(harness.store.claimDedupe(claimInput(lease, 'move-1'))).rejects.toMatchObject({
      code: 'FENCE_EXHAUSTED',
    })
    const rows = await harness.db
      .select({ claimCounter: schema.runs.claimCounter })
      .from(schema.runs)
      .where(eq(schema.runs.key, lease.key))
    expect(rows).toEqual([{ claimCounter: Number.MAX_SAFE_INTEGER }])
  })

  it('serializes an old-fence takeover request once', async () => {
    const harness = await createHarness()
    const first = await acquire(harness.store, 'takeover-json-run')
    await claimDedupe(harness.store, first, 'move-1')
    harness.advance(10)
    const takeover = await harness.store.acquire('takeover-json-run', 'worker-b')
    expect(takeover.ok).toBe(true)
    if (!takeover.ok) throw new Error(takeover.code)
    let calls = 0
    const request = {
      toJSON() {
        calls += 1
        return { call: calls }
      },
    }

    expect(
      await harness.store.claimDedupe({ ...claimInput(takeover.lease, 'move-1'), request }),
    ).toMatchObject({ ok: true, status: 'claimed', request: { call: 1 } })
    expect(calls).toBe(1)
    expect(await harness.store.claimDedupe(claimInput(takeover.lease, 'move-1'))).toMatchObject({
      ok: true,
      status: 'pending',
      request: { call: 1 },
    })
  })
})

async function createHarness() {
  const harness = await createPgHarness()
  openClients.push(harness.client)
  return harness
}

async function acquire(store: DurableStore, key: string): Promise<Lease> {
  const acquired = await store.acquire(key, 'worker-a')
  expect(acquired.ok).toBe(true)
  if (!acquired.ok) throw new Error(acquired.code)
  return acquired.lease
}

async function claimDedupe(store: DurableStore, lease: Lease, id: string) {
  const result = await store.claimDedupe(claimInput(lease, id))
  expect(result).toMatchObject({ ok: true, status: 'claimed' })
  if (!result.ok || result.status !== 'claimed') throw new Error('dedupe claim failed')
  return result
}

function claimInput(lease: Lease, id: string) {
  return { lease, id, digest: 'north' }
}

function completion(claimId: string, result: unknown) {
  return {
    id: 'move-1',
    digest: 'north',
    claimId,
    result,
  }
}

async function commitSnapshot(
  store: DurableStore,
  lease: Lease,
  expected: Version | null,
  version: Version,
): Promise<void> {
  expect(
    await store.commit({
      lease,
      expected,
      next: { value: { tick: version.seq }, version },
    }),
  ).toEqual({ ok: true, version })
}
