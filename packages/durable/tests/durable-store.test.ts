import { describe, expect, it } from 'vitest'
import { createMemoryDurableStore, type Lease, type MemoryDurableStore, type Version } from '../src'

function testStore(options: Parameters<typeof createMemoryDurableStore>[0] = {}) {
  let now = 0
  const store = createMemoryDurableStore({ ...options, now: () => now })
  return {
    store,
    advance(milliseconds: number) {
      now += milliseconds
    },
  }
}

async function acquire(store: MemoryDurableStore, key: string, ownerId: string): Promise<Lease> {
  const result = await store.acquire(key, ownerId)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`acquire failed: ${result.code}`)
  return result.lease
}

async function commitInitial(store: MemoryDurableStore, lease: Lease, value: unknown) {
  return store.commit({
    lease,
    expected: null,
    next: { value, version: { epoch: 0, seq: 0 } },
  })
}

describe('createMemoryDurableStore', () => {
  it('acquires, fences, renews, and releases leases atomically', async () => {
    const { store, advance } = testStore({ leaseTtlMs: 10 })
    const first = await store.acquire('run-1', 'worker-a')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.code)

    const busy = await store.acquire('run-1', 'worker-b')
    expect(busy).toEqual({ ok: false, code: 'LEASE_BUSY', retryAt: 10 })

    const renewed = await store.renew(first.lease, { ttlMs: 20 })
    expect(renewed.ok).toBe(true)
    if (!renewed.ok) throw new Error(renewed.code)
    expect(renewed.lease.fence).toBe(first.lease.fence)
    expect(renewed.lease.expiresAt).toBe(20)

    advance(20)
    const takeover = await store.acquire('run-1', 'worker-b')
    expect(takeover.ok).toBe(true)
    if (!takeover.ok) throw new Error(takeover.code)
    expect(Number(takeover.lease.fence)).toBeGreaterThan(Number(first.lease.fence))

    expect(await store.renew(first.lease)).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(await store.release(first.lease)).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(await store.release(takeover.lease)).toEqual({ ok: true })
  })

  it('uses both epoch and sequence for snapshot CAS', async () => {
    const { store } = testStore()
    const lease = await acquire(store, 'run-2', 'worker-a')

    expect(await commitInitial(store, lease, { status: 'idle' })).toEqual({
      ok: true,
      version: { epoch: 0, seq: 0 },
    })
    expect(
      await store.commit({
        lease,
        expected: { epoch: 0, seq: 0 },
        next: { value: { status: 'waiting' }, version: { epoch: 0, seq: 1 } },
      }),
    ).toEqual({ ok: true, version: { epoch: 0, seq: 1 } })

    expect(
      await store.commit({
        lease,
        expected: { epoch: 0, seq: 0 },
        next: { value: { status: 'stale' }, version: { epoch: 1, seq: 0 } },
      }),
    ).toEqual({ ok: false, code: 'CAS_CONFLICT', actual: { epoch: 0, seq: 1 } })
    expect(
      await store.commit({
        lease,
        expected: { epoch: 0, seq: 1 },
        next: { value: { status: 'same' }, version: { epoch: 0, seq: 1 } },
      }),
    ).toEqual({ ok: false, code: 'INVALID_VERSION' })
    expect(await store.read('run-2')).toEqual({
      value: { status: 'waiting' },
      version: { epoch: 0, seq: 1 },
    })
  })

  it('deduplicates commands and events by id plus digest', async () => {
    const { store, advance } = testStore({
      leaseTtlMs: 100,
      retention: { completedDedupeMs: 5, timerClaimMs: 100 },
    })
    const lease = await acquire(store, 'run-3', 'worker-a')

    const claimed = await store.claimDedupe({
      lease,
      kind: 'command',
      id: 'command-1',
      digest: 'digest-a',
      request: { action: 'start' },
    })
    expect(claimed).toEqual({
      ok: true,
      status: 'claimed',
      claimId: 'dedupe:1',
      request: { action: 'start' },
    })
    if (!claimed.ok || claimed.status !== 'claimed') throw new Error('claim failed')

    expect(
      await store.claimDedupe({
        lease,
        kind: 'command',
        id: 'command-1',
        digest: 'digest-a',
      }),
    ).toEqual({
      ok: true,
      status: 'pending',
      claimId: claimed.claimId,
      ownerFence: lease.fence,
      claimedAt: 0,
      request: { action: 'start' },
    })
    expect(
      await store.claimDedupe({
        lease,
        kind: 'command',
        id: 'command-1',
        digest: 'digest-b',
      }),
    ).toEqual({ ok: false, code: 'DEDUPLICATE_CONFLICT', existingDigest: 'digest-a' })

    expect(
      await store.commit({
        lease,
        expected: null,
        completeDedupe: {
          kind: 'command',
          id: 'command-1',
          digest: 'digest-a',
          claimId: claimed.claimId,
          result: { accepted: true },
        },
      }),
    ).toEqual({ ok: true, version: null })
    expect(
      await store.claimDedupe({
        lease,
        kind: 'command',
        id: 'command-1',
        digest: 'digest-a',
      }),
    ).toEqual({ ok: true, status: 'completed', digest: 'digest-a', result: { accepted: true } })

    advance(5)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 1, timerClaimsRemoved: 0 })
    const afterRetention = await store.claimDedupe({
      lease,
      kind: 'command',
      id: 'command-1',
      digest: 'digest-a',
    })
    expect(afterRetention.ok && afterRetention.status === 'claimed').toBe(true)
  })

  it('lets a new fence take over a pending dedupe claim', async () => {
    const { store, advance } = testStore({ leaseTtlMs: 10 })
    const first = await store.acquire('run-4', 'worker-a')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.code)
    const oldClaim = await store.claimDedupe({
      lease: first.lease,
      kind: 'event',
      id: 'event-1',
      digest: 'digest-a',
    })
    expect(oldClaim.ok && oldClaim.status === 'claimed').toBe(true)
    if (!oldClaim.ok || oldClaim.status !== 'claimed') throw new Error('claim failed')

    advance(10)
    const second = await store.acquire('run-4', 'worker-b')
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.code)
    const newClaim = await store.claimDedupe({
      lease: second.lease,
      kind: 'event',
      id: 'event-1',
      digest: 'digest-a',
    })
    expect(newClaim.ok && newClaim.status === 'claimed').toBe(true)
    if (!newClaim.ok || newClaim.status !== 'claimed') throw new Error('takeover failed')
    expect(newClaim.claimId).not.toBe(oldClaim.claimId)

    expect(
      await store.commit({
        lease: first.lease,
        expected: null,
        completeDedupe: {
          kind: 'event',
          id: 'event-1',
          digest: 'digest-a',
          claimId: oldClaim.claimId,
          result: 'old',
        },
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
  })

  it('claims due timers only for the current snapshot version', async () => {
    const { store, advance } = testStore({ leaseTtlMs: 100 })
    const lease = await acquire(store, 'run-5', 'worker-a')
    await commitInitial(store, lease, { status: 'waiting' })
    const expected: Version = { epoch: 0, seq: 0 }

    expect(await store.claimTimer({ lease, timerId: 'wake', dueAt: 10, expected })).toEqual({
      ok: false,
      code: 'TIMER_NOT_DUE',
      dueAt: 10,
    })
    advance(10)
    const claimed = await store.claimTimer({ lease, timerId: 'wake', dueAt: 10, expected })
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) throw new Error(claimed.code)
    expect(await store.claimTimer({ lease, timerId: 'wake', dueAt: 10, expected })).toEqual({
      ok: false,
      code: 'TIMER_ALREADY_CLAIMED',
      claimId: claimed.claimId,
      ownerFence: lease.fence,
      claimedUntil: 100,
    })

    expect(
      await store.commit({
        lease,
        expected,
        next: { value: { status: 'awake' }, version: { epoch: 0, seq: 1 } },
        completeTimer: {
          timerId: 'wake',
          dueAt: 10,
          expected,
          claimId: claimed.claimId,
        },
      }),
    ).toEqual({ ok: true, version: { epoch: 0, seq: 1 } })
    expect(
      await store.claimTimer({
        lease,
        timerId: 'wake',
        dueAt: 10,
        expected,
      }),
    ).toEqual({ ok: false, code: 'TIMER_STALE', actual: { epoch: 0, seq: 1 } })
  })

  it('reclaims a timer after lease failover and fences the old completion', async () => {
    const { store, advance } = testStore({ leaseTtlMs: 10, timerClaimTtlMs: 100 })
    const first = await store.acquire('run-5b', 'worker-a')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.code)
    await commitInitial(store, first.lease, { status: 'waiting' })
    const oldClaim = await store.claimTimer({
      lease: first.lease,
      timerId: 'wake',
      dueAt: 0,
      expected: { epoch: 0, seq: 0 },
    })
    expect(oldClaim.ok).toBe(true)
    if (!oldClaim.ok) throw new Error(oldClaim.code)

    advance(10)
    const second = await store.acquire('run-5b', 'worker-b')
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.code)
    const newClaim = await store.claimTimer({
      lease: second.lease,
      timerId: 'wake',
      dueAt: 0,
      expected: { epoch: 0, seq: 0 },
    })
    expect(newClaim.ok).toBe(true)
    if (!newClaim.ok) throw new Error(newClaim.code)
    expect(newClaim.claimId).not.toBe(oldClaim.claimId)

    expect(
      await store.commit({
        lease: first.lease,
        expected: { epoch: 0, seq: 0 },
        completeTimer: {
          timerId: 'wake',
          dueAt: 0,
          expected: { epoch: 0, seq: 0 },
          claimId: oldClaim.claimId,
        },
      }),
    ).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(
      await store.commit({
        lease: second.lease,
        expected: { epoch: 0, seq: 0 },
        next: { value: { status: 'awake' }, version: { epoch: 0, seq: 1 } },
        completeTimer: {
          timerId: 'wake',
          dueAt: 0,
          expected: { epoch: 0, seq: 0 },
          claimId: newClaim.claimId,
        },
      }),
    ).toEqual({ ok: true, version: { epoch: 0, seq: 1 } })
  })

  it('retains expired timer claims until a sweep removes them', async () => {
    const { store, advance } = testStore({
      leaseTtlMs: 100,
      timerClaimTtlMs: 5,
      retention: { completedDedupeMs: 100, timerClaimMs: 0 },
    })
    const lease = await acquire(store, 'run-5c', 'worker-a')
    await commitInitial(store, lease, { status: 'waiting' })
    expect(
      await store.claimTimer({
        lease,
        timerId: 'wake',
        dueAt: 0,
        expected: { epoch: 0, seq: 0 },
      }),
    ).toMatchObject({ ok: true })
    advance(5)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 0, timerClaimsRemoved: 1 })
  })

  it('does not complete claims when the CAS fails', async () => {
    const { store } = testStore()
    const lease = await acquire(store, 'run-6', 'worker-a')
    await commitInitial(store, lease, { status: 'waiting' })
    const dedupe = await store.claimDedupe({
      lease,
      kind: 'command',
      id: 'command-1',
      digest: 'digest-a',
    })
    const timer = await store.claimTimer({
      lease,
      timerId: 'wake',
      dueAt: 0,
      expected: { epoch: 0, seq: 0 },
    })
    expect(dedupe.ok && dedupe.status === 'claimed').toBe(true)
    expect(timer.ok).toBe(true)
    if (!dedupe.ok || dedupe.status !== 'claimed' || !timer.ok) throw new Error('claim failed')

    expect(
      await store.commit({
        lease,
        expected: { epoch: 9, seq: 9 },
        next: { value: { status: 'wrong' }, version: { epoch: 9, seq: 10 } },
        completeDedupe: {
          kind: 'command',
          id: 'command-1',
          digest: 'digest-a',
          claimId: dedupe.claimId,
          result: 'done',
        },
        completeTimer: {
          timerId: 'wake',
          dueAt: 0,
          expected: { epoch: 0, seq: 0 },
          claimId: timer.claimId,
        },
      }),
    ).toEqual({ ok: false, code: 'CAS_CONFLICT', actual: { epoch: 0, seq: 0 } })
    const pending = await store.claimDedupe({
      lease,
      kind: 'command',
      id: 'command-1',
      digest: 'digest-a',
    })
    expect(pending.ok && pending.status === 'pending').toBe(true)
    expect(
      await store.claimTimer({
        lease,
        timerId: 'wake',
        dueAt: 0,
        expected: { epoch: 0, seq: 0 },
      }),
    ).toMatchObject({ ok: false, code: 'TIMER_ALREADY_CLAIMED' })
  })

  it('linearizes concurrent acquisition attempts', async () => {
    const { store } = testStore()
    const results = await Promise.all([
      store.acquire('run-7', 'worker-a'),
      store.acquire('run-7', 'worker-b'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(await store.keys()).toEqual(['run-7'])
  })
})
