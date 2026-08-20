/**
 * An opaque fencing token. A new token is issued every time a lease changes
 * owner, including after an expired lease.
 *
 * @public
 */
export type FenceToken = string

/**
 * The two coordinates a host compares when it commits a snapshot.
 *
 * @public
 */
export interface Version {
  readonly epoch: number
  readonly seq: number
}

/**
 * A versioned value stored by a `DurableStore`.
 *
 * The value must be JSON-serializable for the in-memory adapter and should be
 * JSON-serializable for every production adapter.
 *
 * @public
 */
export interface DurableRecord<Value = unknown> {
  readonly value: Value
  readonly version: Version
}

/**
 * A lease and its fencing token. Pass the complete value returned by
 * `DurableStore.acquire`, `renew`, or a successful renewal back to later calls.
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
 * Lease timing options. The adapter supplies its configured default when this
 * value is omitted.
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
 * A lease acquisition result. Acquisition and the first snapshot read happen
 * in one linearizable operation.
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
      readonly retryAt: number
    }

/**
 * A lease renewal result.
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
 * The namespace used by durable idempotency records.
 *
 * @public
 */
export type DedupeKind = 'command' | 'event'

/**
 * A request to claim a command or event id. `digest` must identify the full
 * logical request, not only its caller-generated id.
 *
 * @public
 */
export interface DedupeClaimInput {
  readonly lease: Lease
  readonly kind: DedupeKind
  readonly id: string
  readonly digest: string
  readonly request?: unknown
}

/**
 * The result of a durable command or event claim.
 *
 * @public
 */
export type DedupeClaimResult =
  | {
      readonly ok: true
      readonly status: 'claimed'
      readonly claimId: string
      readonly request?: unknown
    }
  | {
      readonly ok: true
      readonly status: 'pending'
      readonly claimId: string
      readonly ownerFence: FenceToken
      readonly claimedAt: number
      readonly request?: unknown
    }
  | {
      readonly ok: true
      readonly status: 'completed'
      readonly digest: string
      readonly result: unknown
    }
  | {
      readonly ok: false
      readonly code: 'LEASE_LOST'
    }
  | {
      readonly ok: false
      readonly code: 'DEDUPLICATE_CONFLICT'
      readonly existingDigest: string
    }

/**
 * The durable completion marker for a previously claimed command or event.
 * It is applied atomically with the snapshot passed to `DurableStore.commit`.
 *
 * @public
 */
export interface DedupeCompletion {
  readonly kind: DedupeKind
  readonly id: string
  readonly digest: string
  readonly claimId: string
  readonly result: unknown
}

/**
 * The identity of a claimed timer. The expected version prevents an old timer
 * callback from claiming a timer that was removed or replaced by a later
 * snapshot.
 *
 * @public
 */
export interface TimerClaimInput {
  readonly lease: Lease
  readonly timerId: string
  readonly dueAt: number
  readonly expected: Version
}

/**
 * The result of a durable timer claim.
 *
 * @public
 */
export type TimerClaimResult =
  | {
      readonly ok: true
      readonly claimId: string
      readonly timerId: string
      readonly dueAt: number
      readonly expected: Version
    }
  | {
      readonly ok: false
      readonly code: 'LEASE_LOST'
    }
  | {
      readonly ok: false
      readonly code: 'TIMER_NOT_DUE'
      readonly dueAt: number
    }
  | {
      readonly ok: false
      readonly code: 'TIMER_STALE'
      readonly actual: Version | null
    }
  | {
      readonly ok: false
      readonly code: 'TIMER_ALREADY_CLAIMED'
      readonly claimId: string
      readonly ownerFence: FenceToken
      readonly claimedUntil: number
    }

/**
 * The durable completion marker for a claimed timer. It is applied atomically
 * with the snapshot passed to `DurableStore.commit`.
 *
 * @public
 */
export interface TimerCompletion {
  readonly timerId: string
  readonly dueAt: number
  readonly expected: Version
  readonly claimId: string
}

/**
 * A compare-and-swap commit. `next`, `completeDedupe`, or `completeTimer` must
 * be supplied. All supplied changes succeed or none of them are persisted.
 *
 * @public
 */
export interface CommitInput {
  readonly lease: Lease
  readonly expected: Version | null
  readonly next?: DurableRecord
  readonly completeDedupe?: DedupeCompletion
  readonly completeTimer?: TimerCompletion
}

/**
 * The result of a compare-and-swap commit.
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
 * Retention limits for coordination metadata. Snapshot rows are not removed by
 * this hook because their lifecycle belongs to the host application.
 *
 * @public
 */
export interface RetentionPolicy {
  readonly completedDedupeMs: number
  readonly timerClaimMs: number
}

/**
 * Controls one retention pass. `limit` bounds total metadata removals.
 *
 * @public
 */
export interface RetentionSweepOptions {
  readonly limit?: number
}

/**
 * Counts removed coordination records from a retention pass.
 *
 * @public
 */
export interface RetentionSweepResult {
  readonly dedupeRemoved: number
  readonly timerClaimsRemoved: number
}

/**
 * The storage and coordination contract. Every mutating operation is required
 * to be linearizable by an adapter. It does not attach to `FlowRun`, execute
 * tasks, or define the runtime commit barrier.
 *
 * @public
 */
export interface DurableStore {
  /** Acquire a key lease and read its current record atomically. */
  acquire(key: string, ownerId: string, options?: LeaseOptions): Promise<AcquireLeaseResult>
  /** Read a record without acquiring a lease. */
  read(key: string): Promise<DurableRecord | null>
  /** Extend a still-live lease without changing its fence. */
  renew(lease: Lease, options?: LeaseOptions): Promise<RenewLeaseResult>
  /** Release the current lease if the fence still matches. */
  release(lease: Lease): Promise<ReleaseLeaseResult>
  /** Compare and swap a record and optional completion markers atomically. */
  commit(input: CommitInput): Promise<CommitResult>
  /** Claim a command or event id, or replay its completed result. */
  claimDedupe(input: DedupeClaimInput): Promise<DedupeClaimResult>
  /** Claim one due timer for the expected snapshot version. */
  claimTimer(input: TimerClaimInput): Promise<TimerClaimResult>
  /** Remove expired coordination metadata. Snapshot records remain intact. */
  sweep(options?: RetentionSweepOptions): Promise<RetentionSweepResult>
}

/**
 * Codes thrown for malformed input or an in-memory serialization failure.
 * Expected races use the typed result unions instead.
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

/**
 * Options for the test adapter. Its clock is read inside each operation, so a
 * mutable clock can exercise expiry and retention without sleeping.
 *
 * @public
 */
export interface MemoryDurableStoreOptions {
  readonly now?: () => number
  readonly leaseTtlMs?: number
  readonly timerClaimTtlMs?: number
  readonly retention?: RetentionPolicy
}

/**
 * The in-memory implementation adds inspection helpers while retaining the
 * exact `DurableStore` contract.
 *
 * @public
 */
export interface MemoryDurableStore extends DurableStore {
  /** Return the keys that have acquired a lease or stored metadata. */
  keys(): readonly string[]
  /** Remove all rows and coordination metadata. */
  clear(): void
}
