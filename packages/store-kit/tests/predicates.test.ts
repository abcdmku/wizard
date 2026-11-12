import { DurableStoreError, type Lease } from '@openwizard/durable/store'
import {
  compareVersion,
  type DedupeClaimView,
  isCompletableDedupe,
  isCompletableTimer,
  isCurrentLease,
  isOpenClaim,
  makeStoreConfiguration,
  nextCounter,
  readLimit,
  readNow,
  readTtl,
  sameVersion,
  serializeJson,
  type TimerClaimView,
} from '@openwizard/store-kit'
import { describe, expect, it } from 'vitest'

const lease: Lease = { key: 'run-1', ownerId: 'worker-a', fence: '3', expiresAt: 1_000 }
const held = { ownerId: 'worker-a', fence: '3', expiresAt: 1_000 }

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(DurableStoreError)
    return (error as DurableStoreError).code
  }
  throw new Error('expected a DurableStoreError')
}

describe('isCurrentLease', () => {
  it('accepts the stored owner and fence before expiry', () => {
    expect(isCurrentLease(held, lease, 999)).toBe(true)
  })

  it('reads the stored expiry, not the one the caller sent', () => {
    expect(isCurrentLease(held, { ...lease, expiresAt: 5_000 }, 1_000)).toBe(false)
  })

  it.each([
    ['no lease', undefined],
    ['no row', null],
    ['a released lease', { ownerId: null, fence: null, expiresAt: null }],
    ['another owner', { ...held, ownerId: 'worker-b' }],
    ['another fence', { ...held, fence: '4' }],
  ])('rejects %s', (_name, stored) => {
    expect(isCurrentLease(stored, lease, 0)).toBe(false)
  })
})

describe('dedupe claim predicates', () => {
  const pending: DedupeClaimView = {
    status: 'pending',
    digest: 'd',
    claimId: 'dedupe:1',
    ownerFence: '3',
  }
  const completion = { id: 'cmd-1', digest: 'd', claimId: 'dedupe:1', result: null }

  it('holds a pending or applied claim of the same fence', () => {
    expect(isOpenClaim(pending, completion, '3')).toBe(true)
    expect(isOpenClaim({ ...pending, status: 'applied' }, completion, '3')).toBe(true)
  })

  it.each([
    ['a missing claim', undefined],
    ['a missing row', null],
    ['a completed claim', { status: 'completed', digest: 'd' } as const],
    ['another claim id', { ...pending, claimId: 'dedupe:2' }],
    ['another fence', { ...pending, ownerFence: '2' }],
  ])('does not hold %s', (_name, entry) => {
    expect(isOpenClaim(entry, completion, '3')).toBe(false)
    expect(isCompletableDedupe(entry, completion, '3')).toBe(false)
  })

  it('completes only with the claimed digest', () => {
    expect(isCompletableDedupe(pending, completion, '3')).toBe(true)
    expect(isCompletableDedupe(pending, { ...completion, digest: 'other' }, '3')).toBe(false)
  })
})

describe('isCompletableTimer', () => {
  const claim: TimerClaimView = {
    dueAt: 10,
    expected: { epoch: 0, seq: 1 },
    claimId: 'timer:1',
    ownerFence: '3',
  }
  const completion = { timerId: 't', dueAt: 10, expected: { epoch: 0, seq: 1 }, claimId: 'timer:1' }

  it('matches due time, version, claim id and fence', () => {
    expect(isCompletableTimer(claim, completion, '3')).toBe(true)
  })

  it.each([
    ['a missing claim', undefined, completion, '3'],
    ['a missing row', null, completion, '3'],
    ['another due time', claim, { ...completion, dueAt: 11 }, '3'],
    ['another version', claim, { ...completion, expected: { epoch: 0, seq: 2 } }, '3'],
    ['another claim id', claim, { ...completion, claimId: 'timer:2' }, '3'],
    ['another fence', claim, completion, '4'],
  ])('rejects %s', (_name, entry, input, fence) => {
    expect(isCompletableTimer(entry, input, fence)).toBe(false)
  })
})

describe('versions', () => {
  it('orders by epoch, then seq', () => {
    expect(compareVersion({ epoch: 1, seq: 0 }, { epoch: 0, seq: 9 })).toBeGreaterThan(0)
    expect(compareVersion({ epoch: 0, seq: 1 }, { epoch: 0, seq: 2 })).toBeLessThan(0)
    expect(compareVersion({ epoch: 2, seq: 2 }, { epoch: 2, seq: 2 })).toBe(0)
  })

  it('treats two absent records as the same version', () => {
    expect(sameVersion(null, null)).toBe(true)
    expect(sameVersion(null, { epoch: 0, seq: 0 })).toBe(false)
    expect(sameVersion({ epoch: 0, seq: 0 }, null)).toBe(false)
    expect(sameVersion({ epoch: 1, seq: 2 }, { epoch: 1, seq: 2 })).toBe(true)
    expect(sameVersion({ epoch: 1, seq: 2 }, { epoch: 1, seq: 3 })).toBe(false)
  })
})

describe('nextCounter', () => {
  it('adds one', () => {
    expect(nextCounter(0, 'run-1', 'fence')).toBe(1)
  })

  it.each([[Number.MAX_SAFE_INTEGER], [-1], [1.5], [Number.NaN]])('refuses %j', (current) => {
    expect(() => nextCounter(current, 'run-1', 'claim')).toThrow(
      "claim counter exhausted for 'run-1'",
    )
    expect(codeOf(() => nextCounter(current, 'run-1', 'claim'))).toBe('FENCE_EXHAUSTED')
  })
})

describe('serializeJson', () => {
  it('returns JSON text', () => {
    expect(serializeJson({ n: 1 }, 'next record')).toBe('{"n":1}')
  })

  it('rejects a value JSON cannot hold', () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expect(codeOf(() => serializeJson(cycle, 'next record'))).toBe('NOT_SERIALIZABLE')
    expect(codeOf(() => serializeJson(undefined, 'next record'))).toBe('NOT_SERIALIZABLE')
    expect(codeOf(() => serializeJson(10n, 'next record'))).toBe('NOT_SERIALIZABLE')
  })
})

describe('store configuration', () => {
  it('applies the defaults', () => {
    const configuration = makeStoreConfiguration({})
    expect(configuration).toMatchObject({
      leaseTtlMs: 30_000,
      timerClaimTtlMs: 30_000,
      completedDedupeMs: 7 * 24 * 60 * 60 * 1000,
      timerClaimMs: 5 * 60 * 1000,
    })
    expect(configuration.now).toBe(Date.now)
  })

  it('keeps what the caller set, including zero retention', () => {
    const now = () => 42
    expect(
      makeStoreConfiguration({
        now,
        leaseTtlMs: 5,
        timerClaimTtlMs: 6,
        retention: { completedDedupeMs: 0, timerClaimMs: 0 },
      }),
    ).toEqual({ now, leaseTtlMs: 5, timerClaimTtlMs: 6, completedDedupeMs: 0, timerClaimMs: 0 })
  })

  it.each([
    [{ leaseTtlMs: 0 }],
    [{ timerClaimTtlMs: Number.POSITIVE_INFINITY }],
    [{ retention: { completedDedupeMs: -1, timerClaimMs: 0 } }],
    [{ retention: { completedDedupeMs: 0, timerClaimMs: Number.NaN } }],
  ])('rejects %j', (options) => {
    expect(codeOf(() => makeStoreConfiguration(options))).toBe('INVALID_ARGUMENT')
  })

  it('reads a finite clock', () => {
    expect(readNow({ now: () => 7 })).toBe(7)
    expect(codeOf(() => readNow({ now: () => Number.NaN }))).toBe('INVALID_ARGUMENT')
  })

  it('reads a lease TTL', () => {
    expect(readTtl(undefined, 30)).toBe(30)
    expect(readTtl({ ttlMs: 5 }, 30)).toBe(5)
    expect(codeOf(() => readTtl({ ttlMs: 0 }, 30))).toBe('INVALID_ARGUMENT')
  })

  it('reads a sweep limit', () => {
    expect(readLimit(undefined)).toBe(Number.MAX_SAFE_INTEGER)
    expect(readLimit({ limit: 0 })).toBe(0)
    expect(readLimit({ limit: 3 })).toBe(3)
  })

  it.each([[-1], [1.5], [Number.POSITIVE_INFINITY], [2 ** 53]])('rejects limit %j', (limit) => {
    expect(codeOf(() => readLimit({ limit }))).toBe('INVALID_ARGUMENT')
  })
})
