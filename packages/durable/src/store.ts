/**
 * `@openwizard/durable/store`: the `DurableStore` protocol for adapter authors. Every type a
 * store implements or returns, and the `DurableStoreError` it throws for malformed input.
 * `@openwizard/durable/testing` checks an implementation against it.
 *
 * @packageDocumentation
 */

import type {
  DedupeApplication,
  DedupeClaimInput,
  DedupeClaimResult,
  DedupeCompletion,
} from './store-dedupe'

export type {
  DedupeApplication,
  DedupeClaimInput,
  DedupeClaimResult,
  DedupeCompletion,
} from './store-dedupe'

/**
 * An opaque fencing token. A store issues a new token every time a lease
 * changes owner, including a takeover after the previous lease expired. Tokens
 * of one key must never repeat.
 *
 * @public
 */
export type FenceToken = string

/**
 * The two coordinates a host compares when it commits a snapshot. Versions
 * order by `epoch`, then by `seq`; a committed version must be strictly greater
 * than the one it replaces.
 *
 * @public
 */
export interface Version {
  readonly epoch: number
  readonly seq: number
}

/**
 * A versioned value stored by a `DurableStore`. The host stores a core
 * `Snapshot`; the store treats `value` as opaque JSON and must return a copy
 * that is structurally equal to what was committed.
 *
 * @public
 */
export interface DurableRecord<Value = unknown> {
  readonly value: Value
  readonly version: Version
}

/**
 * A lease and its fencing token. Callers pass the complete value returned by
 * `acquire` or the latest successful `renew` back to later calls. A store
 * treats a lease as current only while its owner and fence match the stored
 * lease and the stored expiry is in the future.
 *
 * @public
 */
export interface Lease {
  readonly key: string
  readonly ownerId: string
  readonly fence: FenceToken
  readonly expiresAt: number
}

/**
 * Lease timing for one `acquire` or `renew` call. When `ttlMs` is omitted the
 * store grants `DurableStore.leaseTtlMs`.
 *
 * @public
 */
export interface LeaseOptions {
  readonly ttlMs?: number
}

/**
 * The stable failure codes returned by coordination operations.
 *
 * @public
 */
export type DurableResultCode =
  | 'LEASE_BUSY'
  | 'LEASE_LOST'
  | 'CAS_CONFLICT'
  | 'INVALID_VERSION'
  | 'DEDUPLICATE_CONFLICT'
  | 'TIMER_NOT_DUE'
  | 'TIMER_STALE'
  | 'TIMER_ALREADY_CLAIMED'
  | 'TIMER_CLAIM_LOST'

/**
 * A lease acquisition result. Acquisition and the first record read happen in
 * one linearizable operation, so the new owner sees the latest committed record.
 *
 * @public
 */
export type AcquireLeaseResult =
  | {
      readonly ok: true
      readonly lease: Lease
      readonly record: DurableRecord | null
    }
  | {
      readonly ok: false
      readonly code: 'LEASE_BUSY'
      /** When the current lease expires, on the store clock. */
      readonly retryAt: number
    }

/**
 * A lease renewal result. The fence never changes on renewal.
 *
 * @public
 */
export type RenewLeaseResult =
  | {
      readonly ok: true
      readonly lease: Lease
    }
  | {
      readonly ok: false
      readonly code: 'LEASE_LOST'
    }

/**
 * A lease release result. Releasing an old or expired lease is harmless and
 * reports `LEASE_LOST`.
 *
 * @public
 */
export type ReleaseLeaseResult =
  | {
      readonly ok: true
    }
  | {
      readonly ok: false
      readonly code: 'LEASE_LOST'
    }

/**
 * A compare-and-swap commit. At least one of `next`, `completeDedupe`, or a
 * non-empty `completeTimers` is required (otherwise throw `NOTHING_TO_COMMIT`);
 * `applyDedupe` requires `next` (otherwise throw `INVALID_ARGUMENT`). All
 * supplied changes are persisted together or not at all.
 *
 * @public
 */
export interface CommitInput {
  readonly lease: Lease
  /** The record version the caller last saw; `null` when the key has no record yet. */
  readonly expected: Version | null
  readonly next?: DurableRecord
  /** The command claim whose effects `next` may contain: it becomes `applied`. */
  readonly applyDedupe?: DedupeApplication
  readonly completeDedupe?: DedupeCompletion
  /** Every timer claim the committed snapshot consumed. One lost claim fails the whole commit. */
  readonly completeTimers?: readonly TimerCompletion[]
}

/**
 * The result of a compare-and-swap commit. `version` is the record version
 * after the commit (unchanged when only completion markers were written).
 *
 * @public
 */
export type CommitResult =
  | {
      readonly ok: true
      readonly version: Version | null
    }
  | {
      readonly ok: false
      readonly code: 'LEASE_LOST'
    }
  | {
      readonly ok: false
      readonly code: 'CAS_CONFLICT'
      readonly actual: Version | null
    }
  | {
      readonly ok: false
      readonly code: 'INVALID_VERSION'
    }
  | {
      readonly ok: false
      readonly code: 'DEDUPLICATE_CONFLICT'
    }
  | {
      readonly ok: false
      readonly code: 'TIMER_CLAIM_LOST'
    }

/**
 * Identity and expected record version for a timer claim. A claim succeeds only
 * when `expected` is the stored version and `dueAt` has passed on the store
 * clock; it lasts until the store's timer-claim TTL or the lease expiry,
 * whichever comes first.
 *
 * @public
 */
export interface TimerClaimInput {
  readonly lease: Lease
  readonly timerId: string
  readonly dueAt: number
  readonly expected: Version
}

/** The result of a durable timer claim. @public */
export type TimerClaimResult =
  | {
      readonly ok: true
      readonly claimId: string
      readonly timerId: string
      readonly dueAt: number
      readonly expected: Version
    }
  | { readonly ok: false; readonly code: 'LEASE_LOST' }
  | { readonly ok: false; readonly code: 'TIMER_NOT_DUE'; readonly dueAt: number }
  | { readonly ok: false; readonly code: 'TIMER_STALE'; readonly actual: Version | null }
  | {
      readonly ok: false
      readonly code: 'TIMER_ALREADY_CLAIMED'
      readonly claimId: string
      readonly ownerFence: FenceToken
      readonly claimedUntil: number
    }

/** A timer completion applied atomically with a durable snapshot. @public */
export interface TimerCompletion {
  readonly timerId: string
  readonly dueAt: number
  readonly expected: Version
  readonly claimId: string
}

/** Retention limits (ms) for completed command claims and expired timer claims. @public */
export interface RetentionPolicy {
  readonly completedDedupeMs: number
  readonly timerClaimMs: number
}

/** Controls one retention pass. @public */
export interface RetentionSweepOptions {
  readonly limit?: number
}

/** Counts removed coordination records from a retention pass. @public */
export interface RetentionSweepResult {
  readonly dedupeRemoved: number
  readonly timerClaimsRemoved: number
}

/**
 * The storage and coordination port behind `createDurableRun`. Implement it to
 * put durable runs on your own database; `@openwizard/durable/testing` ships
 * `durableStoreContract`, the conformance suite every adapter should pass.
 *
 * Rules every adapter follows:
 * - Each method is linearizable per key: two concurrent calls behave as if one
 *   ran entirely before the other (use a row lock or a single conditional
 *   statement).
 * - Every mutation first checks that the lease is current (owner, fence, and
 *   an expiry in the future on the store clock) and otherwise returns
 *   `LEASE_LOST` without writing anything.
 * - `commit` checks `expected` against the stored version (`CAS_CONFLICT` with
 *   the actual version), rejects a `next.version` that is not greater
 *   (`INVALID_VERSION`), rejects an `applyDedupe` / `completeDedupe` whose
 *   claim this fence does not hold open (`DEDUPLICATE_CONFLICT`), then applies
 *   the record and markers atomically.
 * - `claimDedupe` answers in this order: completed id with the same digest →
 *   replay; any id with another digest → `DEDUPLICATE_CONFLICT`; open claim of
 *   the same fence → `pending`; claim an older fence applied → `applied`;
 *   stale `expectedVersion` → `CAS_CONFLICT`; otherwise a new claim (which
 *   also takes over a pending, never applied claim of an older fence).
 * - Expected races are result values; throw `DurableStoreError` only for
 *   malformed input or unserializable values.
 *
 * Task execution stays at-least-once; the store makes no exactly-once claim.
 *
 * @public
 */
export interface DurableStore {
  /** The lease TTL (ms) granted when a caller omits `LeaseOptions.ttlMs`. */
  readonly leaseTtlMs: number
  /** Acquire a key lease and read its current record atomically. A new fence is issued. */
  acquire(key: string, ownerId: string, options?: LeaseOptions): Promise<AcquireLeaseResult>
  /** Read a record without acquiring a lease. */
  read(key: string): Promise<DurableRecord | null>
  /** Extend a still-live lease to now + TTL without changing its fence. */
  renew(lease: Lease, options?: LeaseOptions): Promise<RenewLeaseResult>
  /** Release the current lease if the fence still matches. Records stay. */
  release(lease: Lease): Promise<ReleaseLeaseResult>
  /** Compare and swap a record and optional completion markers atomically. */
  commit(input: CommitInput): Promise<CommitResult>
  /** Claim a command id, or replay its completed result. */
  claimDedupe(input: DedupeClaimInput): Promise<DedupeClaimResult>
  /** Claim one due timer for the expected record version. */
  claimTimer(input: TimerClaimInput): Promise<TimerClaimResult>
  /** Remove expired coordination metadata. Records remain intact. */
  sweep(options?: RetentionSweepOptions): Promise<RetentionSweepResult>
}

/**
 * Codes thrown for malformed input or a serialization failure. Expected races
 * use the typed result unions instead.
 *
 * @public
 */
export type DurableStoreErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_VERSION'
  | 'NOTHING_TO_COMMIT'
  | 'NOT_SERIALIZABLE'
  | 'FENCE_EXHAUSTED'

/**
 * Error thrown when a caller violates the storage contract before a mutation
 * can be attempted.
 *
 * @public
 */
export class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode

  constructor(code: DurableStoreErrorCode, message: string) {
    super(message)
    this.name = 'DurableStoreError'
    this.code = code
  }
}
