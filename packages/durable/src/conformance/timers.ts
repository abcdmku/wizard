import { expect, it } from 'vitest'
import { acquire, type ConformanceContext, commitVersion, version0, version1 } from './support'

export function timerCases(context: ConformanceContext): void {
  it('claims due timers once per version and completes them all with the next record', async () => {
    const store = context.store()
    const lease = await acquire(store, 'timer-run')
    await commitVersion(store, lease, null, version0)
    const timer = { lease, timerId: 'wake', dueAt: 2, expected: version0 }

    expect(await store.claimTimer(timer)).toEqual({ ok: false, code: 'TIMER_NOT_DUE', dueAt: 2 })
    context.advance(2)
    const claim = await store.claimTimer(timer)
    expect(claim).toMatchObject({ ok: true, timerId: 'wake', dueAt: 2, expected: version0 })
    if (!claim.ok) throw new Error(claim.code)
    expect(await store.claimTimer(timer)).toEqual({
      ok: false,
      code: 'TIMER_ALREADY_CLAIMED',
      claimId: claim.claimId,
      ownerFence: lease.fence,
      claimedUntil: 7,
    })
    const nudge = await store.claimTimer({ ...timer, timerId: 'nudge' })
    if (!nudge.ok) throw new Error(nudge.code)

    const completions = [
      { timerId: 'wake', dueAt: 2, expected: version0, claimId: claim.claimId },
      { timerId: 'nudge', dueAt: 2, expected: version0, claimId: nudge.claimId },
    ]
    const next = { value: { seq: 1 }, version: version1 }
    const unknown = { timerId: 'other', dueAt: 2, expected: version0, claimId: 'not-claimed' }
    expect(
      await store.commit({
        lease,
        expected: version0,
        next,
        completeTimers: [...completions, unknown],
      }),
    ).toEqual({ ok: false, code: 'TIMER_CLAIM_LOST' })
    expect(await store.read('timer-run')).toEqual({ value: { seq: 0 }, version: version0 })

    expect(
      await store.commit({ lease, expected: version0, next, completeTimers: completions }),
    ).toEqual({ ok: true, version: version1 })
    expect(await store.claimTimer(timer)).toEqual({
      ok: false,
      code: 'TIMER_STALE',
      actual: version1,
    })
    // Completed claims are gone at once; nothing is left for retention to sweep.
    context.advance(10)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 0, timerClaimsRemoved: 0 })
  })

  it('lets a new owner reclaim a timer and fences the old completion', async () => {
    const store = context.store()
    const first = await acquire(store, 'timer-failover-run')
    await commitVersion(store, first, null, version0)
    const oldClaim = await store.claimTimer({
      lease: first,
      timerId: 'wake',
      dueAt: 0,
      expected: version0,
    })
    if (!oldClaim.ok) throw new Error(oldClaim.code)

    context.advance(10)
    const second = await acquire(store, 'timer-failover-run', 'owner-b')
    const newClaim = await store.claimTimer({
      lease: second,
      timerId: 'wake',
      dueAt: 0,
      expected: version0,
    })
    if (!newClaim.ok) throw new Error(newClaim.code)
    expect(newClaim.claimId).not.toBe(oldClaim.claimId)

    const completion = { timerId: 'wake', dueAt: 0, expected: version0 }
    expect(
      await store.commit({
        lease: first,
        expected: version0,
        completeTimers: [{ ...completion, claimId: oldClaim.claimId }],
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(
      await store.commit({
        lease: second,
        expected: version0,
        next: { value: { seq: 1 }, version: version1 },
        completeTimers: [{ ...completion, claimId: oldClaim.claimId }],
      }),
    ).toEqual({ ok: false, code: 'TIMER_CLAIM_LOST' })
    expect(
      await store.commit({
        lease: second,
        expected: version0,
        next: { value: { seq: 1 }, version: version1 },
        completeTimers: [{ ...completion, claimId: newClaim.claimId }],
      }),
    ).toEqual({ ok: true, version: version1 })
  })

  it('keeps expired timer claims until a sweep removes them, honoring the limit', async () => {
    const store = context.store()
    const lease = await acquire(store, 'timer-retention-run')
    await commitVersion(store, lease, null, version0)
    for (const timerId of ['a', 'b']) {
      expect(
        await store.claimTimer({ lease, timerId, dueAt: 0, expected: version0 }),
      ).toMatchObject({ ok: true })
    }

    context.advance(4)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 0, timerClaimsRemoved: 0 })
    context.advance(1)
    expect(await store.sweep({ limit: 1 })).toEqual({ dedupeRemoved: 0, timerClaimsRemoved: 1 })
    expect(await store.sweep()).toEqual({ dedupeRemoved: 0, timerClaimsRemoved: 1 })
    expect(await store.read('timer-retention-run')).toEqual({
      value: { seq: 0 },
      version: version0,
    })
  })
}
