import type { DurableStore, Lease } from '@openwizard/durable/store'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgHarness } from './pg-harness'

const openClients: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()))
})

describe('PostgreSQL metadata fast paths', () => {
  it('does not skip claim counters when the same id is claimed concurrently', async () => {
    const harness = await createHarness()
    const lease = await acquire(harness.store, 'same-id-run')
    const input = {
      lease,
      id: 'move-1',
      digest: 'north',
    }

    const results = await Promise.all([
      harness.store.claimDedupe(input),
      harness.store.claimDedupe(input),
    ])
    expect(results.filter((result) => result.ok && result.status === 'claimed')).toHaveLength(1)
    expect(results.filter((result) => result.ok && result.status === 'pending')).toHaveLength(1)
    expect(
      await harness.store.claimDedupe({
        lease,
        id: 'move-2',
        digest: 'south',
      }),
    ).toMatchObject({ ok: true, status: 'claimed', claimId: 'dedupe:2' })
  })

  it('takes over an old-fence claim without mutating through a stale lease', async () => {
    const harness = await createHarness()
    const first = await acquire(harness.store, 'takeover-run', 'worker-a')
    const claim = await harness.store.claimDedupe({
      lease: first,
      id: 'move-1',
      digest: 'north',
      request: { direction: 'north' },
    })
    expect(claim).toMatchObject({ ok: true, status: 'claimed', claimId: 'dedupe:1' })
    if (!claim.ok || claim.status !== 'claimed') throw new Error('dedupe claim failed')

    harness.advance(10)
    const second = await acquire(harness.store, 'takeover-run', 'worker-b')
    expect(
      await harness.store.commit({
        lease: first,
        expected: null,
        completeDedupe: completion(claim.claimId, 'done'),
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(
      await harness.store.claimDedupe({
        lease: first,
        id: 'stale',
        digest: 'stale',
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(
      await harness.store.claimDedupe({
        lease: second,
        id: 'move-1',
        digest: 'north',
      }),
    ).toEqual({
      ok: true,
      status: 'claimed',
      claimId: 'dedupe:2',
      request: { direction: 'north' },
    })
    expect(
      await harness.store.claimDedupe({
        lease: second,
        id: 'move-2',
        digest: 'south',
      }),
    ).toMatchObject({ ok: true, status: 'claimed', claimId: 'dedupe:3' })
  })
})

async function createHarness() {
  const harness = await createPgHarness()
  openClients.push(harness.client)
  return harness
}

async function acquire(store: DurableStore, key: string, owner = 'worker-a'): Promise<Lease> {
  const result = await store.acquire(key, owner)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.lease
}

function completion(claimId: string, result: unknown) {
  return {
    id: 'move-1',
    digest: 'north',
    claimId,
    result,
  }
}
