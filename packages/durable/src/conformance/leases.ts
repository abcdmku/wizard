import { expect, it } from 'vitest'
import { acquire, type ConformanceContext, claimNew, version0, version1 } from './support'

export function leaseAndRecordCases(context: ConformanceContext): void {
  it('acquires, renews, fences, and releases leases', async () => {
    const store = context.store()
    expect(store.leaseTtlMs).toBe(10)
    const first = await store.acquire('lease-run', 'owner-a')
    expect(first).toMatchObject({
      ok: true,
      lease: { key: 'lease-run', ownerId: 'owner-a', expiresAt: 10 },
      record: null,
    })
    if (!first.ok) throw new Error(first.code)

    expect(await store.acquire('lease-run', 'owner-b')).toEqual({
      ok: false,
      code: 'LEASE_BUSY',
      retryAt: 10,
    })
    expect(await store.renew(first.lease, { ttlMs: 20 })).toEqual({
      ok: true,
      lease: { ...first.lease, expiresAt: 20 },
    })

    context.advance(20)
    expect(
      await store.commit({
        lease: first.lease,
        expected: null,
        next: { value: { state: 'expired' }, version: version0 },
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
    const takeover = await store.acquire('lease-run', 'owner-b')
    if (!takeover.ok) throw new Error(takeover.code)
    expect(takeover.lease.fence).not.toBe(first.lease.fence)
    expect(await store.renew(first.lease)).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(await store.release(first.lease)).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(await store.release(takeover.lease)).toEqual({ ok: true })
    expect(await store.acquire('lease-run', 'owner-c')).toMatchObject({ ok: true })
  })

  it('stores records with epoch and sequence compare-and-swap', async () => {
    const store = context.store()
    const lease = await acquire(store, 'record-run')
    expect(
      await store.commit({ lease, expected: null, next: { value: { n: 0 }, version: version0 } }),
    ).toEqual({ ok: true, version: version0 })
    expect(
      await store.commit({
        lease,
        expected: version0,
        next: { value: { n: 1 }, version: version1 },
      }),
    ).toEqual({ ok: true, version: version1 })
    expect(
      await store.commit({
        lease,
        expected: version1,
        next: { value: { n: 9 }, version: version1 },
      }),
    ).toEqual({ ok: false, code: 'INVALID_VERSION' })
    expect(
      await store.commit({
        lease,
        expected: version0,
        next: { value: { n: 9 }, version: { epoch: 1, seq: 0 } },
      }),
    ).toEqual({ ok: false, code: 'CAS_CONFLICT', actual: version1 })
    expect(await store.read('record-run')).toEqual({ value: { n: 1 }, version: version1 })

    context.advance(10)
    const reopened = await store.acquire('record-run', 'owner-b')
    expect(reopened).toMatchObject({ ok: true, record: { value: { n: 1 }, version: version1 } })
  })

  it('persists nothing when a commit fails its compare-and-swap', async () => {
    const store = context.store()
    const lease = await acquire(store, 'atomic-run')
    await store.commit({ lease, expected: null, next: { value: { n: 0 }, version: version0 } })
    const claimId = await claimNew(store, lease, 'command-1', 'digest-a')
    const timer = await store.claimTimer({ lease, timerId: 'wake', dueAt: 0, expected: version0 })
    if (!timer.ok) throw new Error(timer.code)

    expect(
      await store.commit({
        lease,
        expected: { epoch: 9, seq: 9 },
        next: { value: { n: 10 }, version: { epoch: 9, seq: 10 } },
        completeDedupe: { id: 'command-1', digest: 'digest-a', claimId, result: 'done' },
        completeTimers: [{ timerId: 'wake', dueAt: 0, expected: version0, claimId: timer.claimId }],
      }),
    ).toEqual({ ok: false, code: 'CAS_CONFLICT', actual: version0 })
    expect(await store.read('atomic-run')).toEqual({ value: { n: 0 }, version: version0 })
    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-a' })).toMatchObject({
      ok: true,
      status: 'pending',
      claimId,
    })
    expect(
      await store.claimTimer({ lease, timerId: 'wake', dueAt: 0, expected: version0 }),
    ).toMatchObject({ ok: false, code: 'TIMER_ALREADY_CLAIMED', claimId: timer.claimId })
  })

  it('linearizes concurrent acquisition attempts', async () => {
    const store = context.store()
    const results = await Promise.all([
      store.acquire('concurrent-run', 'owner-a'),
      store.acquire('concurrent-run', 'owner-b'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
  })
}
