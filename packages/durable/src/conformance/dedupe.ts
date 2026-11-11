import type { DedupeApplication, Version } from '@openwizard/durable/store'
import { expect, it } from 'vitest'
import {
  acquire,
  type ConformanceContext,
  claimNew,
  commitVersion,
  version0,
  version1,
  version2,
} from './support'

export function dedupeCases(context: ConformanceContext): void {
  it('recovers a result committed with its snapshot after an owner disappears', async () => {
    const store = context.store()
    const first = await acquire(store, 'atomic-result-recovery')
    await commitVersion(store, first, null, version0)
    const claimId = await claimNew(store, first, 'next-1', 'digest-next')
    expect(
      await store.commit({
        lease: first,
        expected: version0,
        next: { value: { current: 'b' }, version: version1 },
        completeDedupe: {
          id: 'next-1',
          digest: 'digest-next',
          claimId,
          result: { ok: true, seq: 1 },
        },
      }),
    ).toEqual({ ok: true, version: version1 })

    context.advance(10)
    const second = await acquire(store, 'atomic-result-recovery', 'owner-b')
    expect(await store.read('atomic-result-recovery')).toEqual({
      value: { current: 'b' },
      version: version1,
    })
    expect(
      await store.claimDedupe({
        lease: second,
        id: 'next-1',
        digest: 'digest-next',
        expectedVersion: version0,
      }),
    ).toEqual({
      ok: true,
      status: 'completed',
      digest: 'digest-next',
      result: { ok: true, seq: 1 },
    })
  })

  it('claims, completes, and replays a command id and rejects digest reuse', async () => {
    const store = context.store()
    const lease = await acquire(store, 'dedupe-run')
    const claim = await store.claimDedupe({
      lease,
      id: 'command-1',
      digest: 'digest-a',
      request: { action: 'start' },
    })
    expect(claim).toMatchObject({ ok: true, status: 'claimed', request: { action: 'start' } })
    if (!claim.ok || claim.status !== 'claimed') throw new Error('expected a claim')

    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-a' })).toEqual({
      ok: true,
      status: 'pending',
      claimId: claim.claimId,
      ownerFence: lease.fence,
      claimedAt: 0,
      request: { action: 'start' },
    })
    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-b' })).toEqual({
      ok: false,
      code: 'DEDUPLICATE_CONFLICT',
      existingDigest: 'digest-a',
    })

    expect(
      await store.commit({
        lease,
        expected: null,
        completeDedupe: {
          id: 'command-1',
          digest: 'digest-a',
          claimId: claim.claimId,
          result: { accepted: true },
        },
      }),
    ).toEqual({ ok: true, version: null })
    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-a' })).toEqual({
      ok: true,
      status: 'completed',
      digest: 'digest-a',
      result: { accepted: true },
    })
    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-b' })).toEqual({
      ok: false,
      code: 'DEDUPLICATE_CONFLICT',
      existingDigest: 'digest-a',
    })
  })

  it('answers replay, digest conflict, and same-fence pending before a stale version', async () => {
    const store = context.store()
    const lease = await acquire(store, 'dedupe-order-run')
    await commitVersion(store, lease, null, version0)
    const completedClaim = await claimNew(store, lease, 'done-1', 'digest-a', version0)
    await store.commit({
      lease,
      expected: version0,
      completeDedupe: { id: 'done-1', digest: 'digest-a', claimId: completedClaim, result: 1 },
    })
    const pendingClaim = await claimNew(store, lease, 'pending-1', 'digest-a', version0)
    await commitVersion(store, lease, version0, version1)

    const stale = { lease, digest: 'digest-a', expectedVersion: version0 }
    expect(await store.claimDedupe({ ...stale, id: 'done-1' })).toEqual({
      ok: true,
      status: 'completed',
      digest: 'digest-a',
      result: 1,
    })
    expect(await store.claimDedupe({ ...stale, id: 'done-1', digest: 'digest-b' })).toEqual({
      ok: false,
      code: 'DEDUPLICATE_CONFLICT',
      existingDigest: 'digest-a',
    })
    expect(await store.claimDedupe({ ...stale, id: 'pending-1' })).toMatchObject({
      ok: true,
      status: 'pending',
      claimId: pendingClaim,
    })
    expect(await store.claimDedupe({ ...stale, id: 'new-1' })).toEqual({
      ok: false,
      code: 'CAS_CONFLICT',
      actual: version1,
    })
    expect(
      await store.claimDedupe({ ...stale, id: 'new-1', expectedVersion: version1 }),
    ).toMatchObject({ ok: true, status: 'claimed' })
  })

  it('lets a new fence take over a pending claim only at the expected version', async () => {
    const store = context.store()
    const first = await acquire(store, 'takeover-run')
    await commitVersion(store, first, null, version0)
    const oldClaim = await claimNew(store, first, 'command-1', 'digest-a', version0)
    await commitVersion(store, first, version0, version1)

    context.advance(10)
    const second = await acquire(store, 'takeover-run', 'owner-b')
    const claim = { lease: second, id: 'command-1', digest: 'digest-a' }
    expect(await store.claimDedupe({ ...claim, expectedVersion: version0 })).toEqual({
      ok: false,
      code: 'CAS_CONFLICT',
      actual: version1,
    })
    const newClaim = await claimNew(store, second, 'command-1', 'digest-a', version1)
    expect(newClaim).not.toBe(oldClaim)
    expect(
      await store.commit({
        lease: first,
        expected: version1,
        completeDedupe: { id: 'command-1', digest: 'digest-a', claimId: oldClaim, result: 'old' },
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(
      await store.commit({
        lease: second,
        expected: version1,
        completeDedupe: { id: 'command-1', digest: 'digest-a', claimId: oldClaim, result: 'old' },
      }),
    ).toEqual({ ok: false, code: 'DEDUPLICATE_CONFLICT' })
  })

  it('applies a claim with its snapshot, and a newer fence never takes it over', async () => {
    const store = context.store()
    const first = await acquire(store, 'applied-run')
    await commitVersion(store, first, null, version0)
    const applied = await claimNew(store, first, 'applied-1', 'digest-a')
    const unapplied = await claimNew(store, first, 'unapplied-1', 'digest-a')
    const commitApplying = (applyDedupe: DedupeApplication, expected: Version) =>
      store.commit({
        lease: first,
        expected,
        next: { value: { seq: 1 }, version: version1 },
        applyDedupe,
      })
    expect(await commitApplying({ id: 'unapplied-1', claimId: unapplied }, version1)).toEqual({
      ok: false,
      code: 'CAS_CONFLICT',
      actual: version0,
    })
    expect(await commitApplying({ id: 'applied-1', claimId: applied }, version0)).toEqual({
      ok: true,
      version: version1,
    })
    expect(
      await store.claimDedupe({ lease: first, id: 'applied-1', digest: 'digest-a' }),
    ).toMatchObject({ ok: true, status: 'pending', claimId: applied })

    context.advance(10)
    const second = await acquire(store, 'applied-run', 'owner-b')
    const takeover = { lease: second, digest: 'digest-a', expectedVersion: version0 }
    expect(await store.claimDedupe({ ...takeover, id: 'applied-1' })).toEqual({
      ok: true,
      status: 'applied',
    })
    expect(
      await store.claimDedupe({ ...takeover, id: 'unapplied-1', expectedVersion: version1 }),
    ).toMatchObject({ ok: true, status: 'claimed' })
  })

  it('completes an applied claim and replays its result', async () => {
    const store = context.store()
    const lease = await acquire(store, 'applied-completion-run')
    await commitVersion(store, lease, null, version0)
    const claimId = await claimNew(store, lease, 'command-1', 'digest-a')
    await store.commit({
      lease,
      expected: version0,
      next: { value: { seq: 1 }, version: version1 },
      applyDedupe: { id: 'command-1', claimId },
    })
    expect(
      await store.commit({
        lease,
        expected: version1,
        completeDedupe: { id: 'command-1', digest: 'digest-a', claimId, result: 'done' },
      }),
    ).toEqual({ ok: true, version: version1 })
    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-a' })).toEqual({
      ok: true,
      status: 'completed',
      digest: 'digest-a',
      result: 'done',
    })
  })

  it('linearizes a snapshot commit and a claim that race', async () => {
    const store = context.store()
    const lease = await acquire(store, 'race-run')
    await commitVersion(store, lease, null, version0)
    const [committed, claim] = await Promise.all([
      store.commit({ lease, expected: version0, next: { value: { seq: 1 }, version: version1 } }),
      store.claimDedupe({ lease, id: 'command-1', digest: 'digest-a', expectedVersion: version0 }),
    ])
    expect(committed).toEqual({ ok: true, version: version1 })
    if (claim.ok) {
      // The claim linearized first: it stays pending for this fence.
      expect(claim.status).toBe('claimed')
      await commitVersion(store, lease, version1, version2)
      expect(
        await store.claimDedupe({
          lease,
          id: 'command-1',
          digest: 'digest-a',
          expectedVersion: version0,
        }),
      ).toMatchObject({ ok: true, status: 'pending' })
    } else {
      expect(claim).toEqual({ ok: false, code: 'CAS_CONFLICT', actual: version1 })
    }
  })

  it('sweeps completed claims after retention so the id can be claimed again', async () => {
    const store = context.store()
    const lease = await acquire(store, 'retention-dedupe-run')
    await commitVersion(store, lease, null, version0)
    const claimId = await claimNew(store, lease, 'command-1', 'digest-a')
    await store.commit({
      lease,
      expected: version0,
      completeDedupe: { id: 'command-1', digest: 'digest-a', claimId, result: 'accepted' },
    })
    await claimNew(store, lease, 'pending-1', 'digest-a')

    context.advance(4)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 0, timerClaimsRemoved: 0 })
    context.advance(1)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 1, timerClaimsRemoved: 0 })
    expect(await store.read('retention-dedupe-run')).toEqual({
      value: { seq: 0 },
      version: version0,
    })
    expect(await store.claimDedupe({ lease, id: 'command-1', digest: 'digest-b' })).toMatchObject({
      ok: true,
      status: 'claimed',
    })
    expect(await store.claimDedupe({ lease, id: 'pending-1', digest: 'digest-a' })).toMatchObject({
      ok: true,
      status: 'pending',
    })
  })
}
