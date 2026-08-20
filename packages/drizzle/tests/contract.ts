import type { DurableStore, Lease, Version } from '@openwizard/durable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

export interface DurableStoreHarness {
  readonly store: DurableStore
  advance(milliseconds: number): void
  close(): Promise<void>
}

export function durableStoreContract(
  name: string,
  createHarness: () => Promise<DurableStoreHarness>,
): void {
  describe(name, () => {
    let harness: DurableStoreHarness

    beforeEach(async () => {
      harness = await createHarness()
    })

    afterEach(async () => {
      await harness.close()
    })

    it('acquires, renews, releases, and fences leases', async () => {
      const first = await harness.store.acquire('lease-run', 'worker-a')
      expect(first.ok).toBe(true)
      if (!first.ok) throw new Error(first.code)

      expect(await harness.store.acquire('lease-run', 'worker-b')).toEqual({
        ok: false,
        code: 'LEASE_BUSY',
        retryAt: 10,
      })
      expect(await harness.store.renew(first.lease, { ttlMs: 20 })).toEqual({
        ok: true,
        lease: { ...first.lease, expiresAt: 20 },
      })

      harness.advance(20)
      const takeover = await harness.store.acquire('lease-run', 'worker-b')
      expect(takeover.ok).toBe(true)
      if (!takeover.ok) throw new Error(takeover.code)
      expect(Number(takeover.lease.fence)).toBeGreaterThan(Number(first.lease.fence))
      expect(await harness.store.release(first.lease)).toEqual({ ok: false, code: 'LEASE_LOST' })
      expect(await harness.store.release(takeover.lease)).toEqual({ ok: true })
    })

    it('stores snapshots with version compare-and-swap', async () => {
      const lease = await acquire(harness.store, 'snapshot-run')
      expect(
        await harness.store.commit({
          lease,
          expected: null,
          next: { value: { state: 'ready' }, version: { epoch: 0, seq: 0 } },
        }),
      ).toEqual({ ok: true, version: { epoch: 0, seq: 0 } })
      expect(
        await harness.store.commit({
          lease,
          expected: { epoch: 0, seq: 0 },
          next: { value: { state: 'done' }, version: { epoch: 0, seq: 1 } },
        }),
      ).toEqual({ ok: true, version: { epoch: 0, seq: 1 } })
      expect(
        await harness.store.commit({
          lease,
          expected: { epoch: 0, seq: 0 },
          next: { value: { state: 'stale' }, version: { epoch: 1, seq: 0 } },
        }),
      ).toEqual({ ok: false, code: 'CAS_CONFLICT', actual: { epoch: 0, seq: 1 } })
      expect(await harness.store.read('snapshot-run')).toEqual({
        value: { state: 'done' },
        version: { epoch: 0, seq: 1 },
      })
    })

    it('replays completed dedupe results and rejects digest reuse', async () => {
      const lease = await acquire(harness.store, 'dedupe-run')
      const claim = await harness.store.claimDedupe({
        lease,
        kind: 'command',
        id: 'send-email',
        digest: 'request-a',
        request: { recipient: 'ada@example.com' },
      })
      expect(claim).toMatchObject({
        ok: true,
        status: 'claimed',
        request: { recipient: 'ada@example.com' },
      })
      if (!claim.ok || claim.status !== 'claimed') throw new Error('dedupe claim failed')

      expect(
        await harness.store.commit({
          lease,
          expected: null,
          completeDedupe: {
            kind: 'command',
            id: 'send-email',
            digest: 'request-a',
            claimId: claim.claimId,
            result: { messageId: 'message-1' },
          },
        }),
      ).toEqual({ ok: true, version: null })
      expect(
        await harness.store.claimDedupe({
          lease,
          kind: 'command',
          id: 'send-email',
          digest: 'request-a',
        }),
      ).toEqual({
        ok: true,
        status: 'completed',
        digest: 'request-a',
        result: { messageId: 'message-1' },
      })
      expect(
        await harness.store.claimDedupe({
          lease,
          kind: 'command',
          id: 'send-email',
          digest: 'request-b',
        }),
      ).toEqual({
        ok: false,
        code: 'DEDUPLICATE_CONFLICT',
        existingDigest: 'request-a',
      })
    })

    it('claims and completes timers against the expected snapshot', async () => {
      const lease = await acquire(harness.store, 'timer-run')
      const expected: Version = { epoch: 0, seq: 0 }
      await harness.store.commit({
        lease,
        expected: null,
        next: { value: { state: 'waiting' }, version: expected },
      })

      expect(
        await harness.store.claimTimer({ lease, timerId: 'wake', dueAt: 5, expected }),
      ).toEqual({ ok: false, code: 'TIMER_NOT_DUE', dueAt: 5 })
      harness.advance(5)
      const claim = await harness.store.claimTimer({
        lease,
        timerId: 'wake',
        dueAt: 5,
        expected,
      })
      expect(claim.ok).toBe(true)
      if (!claim.ok) throw new Error(claim.code)

      expect(
        await harness.store.commit({
          lease,
          expected,
          next: { value: { state: 'awake' }, version: { epoch: 0, seq: 1 } },
          completeTimer: {
            timerId: 'wake',
            dueAt: 5,
            expected,
            claimId: claim.claimId,
          },
        }),
      ).toEqual({ ok: true, version: { epoch: 0, seq: 1 } })
      expect(
        await harness.store.claimTimer({ lease, timerId: 'wake', dueAt: 5, expected }),
      ).toEqual({ ok: false, code: 'TIMER_STALE', actual: { epoch: 0, seq: 1 } })
    })

    it('removes expired metadata without deleting snapshots', async () => {
      const lease = await acquire(harness.store, 'retention-run')
      await harness.store.commit({
        lease,
        expected: null,
        next: { value: { state: 'waiting' }, version: { epoch: 0, seq: 0 } },
      })
      const dedupe = await harness.store.claimDedupe({
        lease,
        kind: 'event',
        id: 'event-1',
        digest: 'event-a',
      })
      if (!dedupe.ok || dedupe.status !== 'claimed') throw new Error('dedupe claim failed')
      await harness.store.commit({
        lease,
        expected: { epoch: 0, seq: 0 },
        completeDedupe: {
          kind: 'event',
          id: 'event-1',
          digest: 'event-a',
          claimId: dedupe.claimId,
          result: 'accepted',
        },
      })
      expect(
        await harness.store.claimTimer({
          lease,
          timerId: 'expired-timer',
          dueAt: 0,
          expected: { epoch: 0, seq: 0 },
        }),
      ).toMatchObject({ ok: true })

      harness.advance(5)
      expect(await harness.store.sweep()).toEqual({
        dedupeRemoved: 1,
        timerClaimsRemoved: 1,
      })
      expect(await harness.store.read('retention-run')).toEqual({
        value: { state: 'waiting' },
        version: { epoch: 0, seq: 0 },
      })
    })

    it('linearizes concurrent acquisition attempts', async () => {
      const results = await Promise.all([
        harness.store.acquire('concurrent-run', 'worker-a'),
        harness.store.acquire('concurrent-run', 'worker-b'),
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toHaveLength(1)
    })
  })
}

async function acquire(store: DurableStore, key: string): Promise<Lease> {
  const result = await store.acquire(key, 'worker-a')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.lease
}
