//#region src/store-dedupe.d.ts
/**
 * A request to claim a command id. `digest` must identify the full logical
 * request, not only its caller-generated id.
 *
 * `expectedVersion` gates only a new claim or a takeover. An existing replay,
 * digest conflict, same-fence pending claim, or applied claim wins before that
 * version check. `request` is stored with a new claim and echoed back while it
 * is open.
 *
 * Event ids are not claimed here: core records them in the run snapshot, which
 * the host commits with the same fenced CAS as every other state change.
 *
 * @public
 */
interface DedupeClaimInput {
  readonly lease: Lease;
  readonly id: string;
  readonly digest: string;
  readonly expectedVersion?: Version;
  readonly request?: unknown;
}
/**
 * The result of a command claim: a fresh `claimed` id, a claim still owned by
 * this fence (`pending`), a claim an older fence `applied` to a committed
 * snapshot but never completed, or the `completed` result to replay.
 *
 * @public
 */
type DedupeClaimResult = {
  readonly ok: true;
  readonly status: 'claimed';
  readonly claimId: string;
  readonly request?: unknown;
} | {
  readonly ok: true;
  readonly status: 'pending';
  readonly claimId: string;
  readonly ownerFence: FenceToken;
  readonly claimedAt: number;
  readonly request?: unknown;
} | {
  readonly ok: true;
  readonly status: 'applied';
} | {
  readonly ok: true;
  readonly status: 'completed';
  readonly digest: string;
  readonly result: unknown;
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
} | {
  readonly ok: false;
  readonly code: 'CAS_CONFLICT';
  readonly actual: Version | null;
} | {
  readonly ok: false;
  readonly code: 'DEDUPLICATE_CONFLICT';
  readonly existingDigest: string;
};
/**
 * Marks a pending claim of the committing fence `applied`, atomically with `CommitInput.next`. A
 * newer fence never takes an applied claim over, so its command never runs twice. @public
 */
interface DedupeApplication {
  readonly id: string;
  readonly claimId: string;
}
/**
 * Completes a pending or applied claim of the committing fence, atomically with the rest of the
 * commit. @public
 */
interface DedupeCompletion {
  readonly id: string;
  readonly digest: string;
  readonly claimId: string;
  readonly result: unknown;
}
//#endregion
//#region src/store.d.ts
/**
 * An opaque fencing token. A store issues a new token every time a lease
 * changes owner, including a takeover after the previous lease expired. Tokens
 * of one key must never repeat.
 *
 * @public
 */
type FenceToken = string;
/**
 * The two coordinates a host compares when it commits a snapshot. Versions
 * order by `epoch`, then by `seq`; a committed version must be strictly greater
 * than the one it replaces.
 *
 * @public
 */
interface Version {
  readonly epoch: number;
  readonly seq: number;
}
/**
 * A versioned value stored by a `DurableStore`. The host stores a core
 * `Snapshot`; the store treats `value` as opaque JSON and must return a copy
 * that is structurally equal to what was committed.
 *
 * @public
 */
interface DurableRecord<Value = unknown> {
  readonly value: Value;
  readonly version: Version;
}
/**
 * A lease and its fencing token. Callers pass the complete value returned by
 * `acquire` or the latest successful `renew` back to later calls. A store
 * treats a lease as current only while its owner and fence match the stored
 * lease and the stored expiry is in the future.
 *
 * @public
 */
interface Lease {
  readonly key: string;
  readonly ownerId: string;
  readonly fence: FenceToken;
  readonly expiresAt: number;
}
/**
 * Lease timing for one `acquire` or `renew` call. When `ttlMs` is omitted the
 * store grants `DurableStore.leaseTtlMs`.
 *
 * @public
 */
interface LeaseOptions {
  readonly ttlMs?: number;
}
/**
 * The stable failure codes returned by coordination operations.
 *
 * @public
 */
type DurableResultCode = 'LEASE_BUSY' | 'LEASE_LOST' | 'CAS_CONFLICT' | 'INVALID_VERSION' | 'DEDUPLICATE_CONFLICT' | 'TIMER_NOT_DUE' | 'TIMER_STALE' | 'TIMER_ALREADY_CLAIMED' | 'TIMER_CLAIM_LOST';
/**
 * A lease acquisition result. Acquisition and the first record read happen in
 * one linearizable operation, so the new owner sees the latest committed record.
 *
 * @public
 */
type AcquireLeaseResult = {
  readonly ok: true;
  readonly lease: Lease;
  readonly record: DurableRecord | null;
} | {
  readonly ok: false;
  readonly code: 'LEASE_BUSY';
  /** When the current lease expires, on the store clock. */
  readonly retryAt: number;
};
/**
 * A lease renewal result. The fence never changes on renewal.
 *
 * @public
 */
type RenewLeaseResult = {
  readonly ok: true;
  readonly lease: Lease;
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
};
/**
 * A lease release result. Releasing an old or expired lease is harmless and
 * reports `LEASE_LOST`.
 *
 * @public
 */
type ReleaseLeaseResult = {
  readonly ok: true;
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
};
/**
 * A compare-and-swap commit. At least one of `next`, `completeDedupe`, or a
 * non-empty `completeTimers` is required (otherwise throw `NOTHING_TO_COMMIT`);
 * `applyDedupe` requires `next` (otherwise throw `INVALID_ARGUMENT`). All
 * supplied changes are persisted together or not at all.
 *
 * @public
 */
interface CommitInput {
  readonly lease: Lease;
  /** The record version the caller last saw; `null` when the key has no record yet. */
  readonly expected: Version | null;
  readonly next?: DurableRecord;
  /** The command claim whose effects `next` may contain: it becomes `applied`. */
  readonly applyDedupe?: DedupeApplication;
  readonly completeDedupe?: DedupeCompletion;
  /** Every timer claim the committed snapshot consumed. One lost claim fails the whole commit. */
  readonly completeTimers?: readonly TimerCompletion[];
}
/**
 * The result of a compare-and-swap commit. `version` is the record version
 * after the commit (unchanged when only completion markers were written).
 *
 * @public
 */
type CommitResult = {
  readonly ok: true;
  readonly version: Version | null;
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
} | {
  readonly ok: false;
  readonly code: 'CAS_CONFLICT';
  readonly actual: Version | null;
} | {
  readonly ok: false;
  readonly code: 'INVALID_VERSION';
} | {
  readonly ok: false;
  readonly code: 'DEDUPLICATE_CONFLICT';
} | {
  readonly ok: false;
  readonly code: 'TIMER_CLAIM_LOST';
};
/**
 * Identity and expected record version for a timer claim. A claim succeeds only
 * when `expected` is the stored version and `dueAt` has passed on the store
 * clock; it lasts until the store's timer-claim TTL or the lease expiry,
 * whichever comes first.
 *
 * @public
 */
interface TimerClaimInput {
  readonly lease: Lease;
  readonly timerId: string;
  readonly dueAt: number;
  readonly expected: Version;
}
/** The result of a durable timer claim. @public */
type TimerClaimResult = {
  readonly ok: true;
  readonly claimId: string;
  readonly timerId: string;
  readonly dueAt: number;
  readonly expected: Version;
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
} | {
  readonly ok: false;
  readonly code: 'TIMER_NOT_DUE';
  readonly dueAt: number;
} | {
  readonly ok: false;
  readonly code: 'TIMER_STALE';
  readonly actual: Version | null;
} | {
  readonly ok: false;
  readonly code: 'TIMER_ALREADY_CLAIMED';
  readonly claimId: string;
  readonly ownerFence: FenceToken;
  readonly claimedUntil: number;
};
/** A timer completion applied atomically with a durable snapshot. @public */
interface TimerCompletion {
  readonly timerId: string;
  readonly dueAt: number;
  readonly expected: Version;
  readonly claimId: string;
}
/** Retention limits (ms) for completed command claims and expired timer claims. @public */
interface RetentionPolicy {
  readonly completedDedupeMs: number;
  readonly timerClaimMs: number;
}
/** Controls one retention pass. @public */
interface RetentionSweepOptions {
  readonly limit?: number;
}
/** Counts removed coordination records from a retention pass. @public */
interface RetentionSweepResult {
  readonly dedupeRemoved: number;
  readonly timerClaimsRemoved: number;
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
interface DurableStore {
  /** The lease TTL (ms) granted when a caller omits `LeaseOptions.ttlMs`. */
  readonly leaseTtlMs: number;
  /** Acquire a key lease and read its current record atomically. A new fence is issued. */
  acquire(key: string, ownerId: string, options?: LeaseOptions): Promise<AcquireLeaseResult>;
  /** Read a record without acquiring a lease. */
  read(key: string): Promise<DurableRecord | null>;
  /** Extend a still-live lease to now + TTL without changing its fence. */
  renew(lease: Lease, options?: LeaseOptions): Promise<RenewLeaseResult>;
  /** Release the current lease if the fence still matches. Records stay. */
  release(lease: Lease): Promise<ReleaseLeaseResult>;
  /** Compare and swap a record and optional completion markers atomically. */
  commit(input: CommitInput): Promise<CommitResult>;
  /** Claim a command id, or replay its completed result. */
  claimDedupe(input: DedupeClaimInput): Promise<DedupeClaimResult>;
  /** Claim one due timer for the expected record version. */
  claimTimer(input: TimerClaimInput): Promise<TimerClaimResult>;
  /** Remove expired coordination metadata. Records remain intact. */
  sweep(options?: RetentionSweepOptions): Promise<RetentionSweepResult>;
}
/**
 * Codes thrown for malformed input or a serialization failure. Expected races
 * use the typed result unions instead.
 *
 * @public
 */
type DurableStoreErrorCode = 'INVALID_ARGUMENT' | 'INVALID_VERSION' | 'NOTHING_TO_COMMIT' | 'NOT_SERIALIZABLE' | 'FENCE_EXHAUSTED';
/**
 * Error thrown when a caller violates the storage contract before a mutation
 * can be attempted.
 *
 * @public
 */
declare class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode;
  constructor(code: DurableStoreErrorCode, message: string);
}
//#endregion
export { AcquireLeaseResult, CommitInput, CommitResult, type DedupeApplication, type DedupeClaimInput, type DedupeClaimResult, type DedupeCompletion, DurableRecord, DurableResultCode, DurableStore, DurableStoreError, DurableStoreErrorCode, FenceToken, Lease, LeaseOptions, ReleaseLeaseResult, RenewLeaseResult, RetentionPolicy, RetentionSweepOptions, RetentionSweepResult, TimerClaimInput, TimerClaimResult, TimerCompletion, Version };
//# sourceMappingURL=store.d.ts.map