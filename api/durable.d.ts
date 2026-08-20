import { AnyFlow, Command, CommandResult, EventType, FlowRun, ResumeOptions, RunOptions, SendResult } from "@openwizard/core";
//#region src/contracts.d.ts
/**
 * An opaque fencing token. A new token is issued every time a lease changes
 * owner, including after an expired lease.
 *
 * @public
 */
type FenceToken = string;
/**
 * The two coordinates a host compares when it commits a snapshot.
 *
 * @public
 */
interface Version {
  readonly epoch: number;
  readonly seq: number;
}
/**
 * A versioned value stored by a `DurableStore`.
 *
 * The value must be JSON-serializable for the in-memory adapter and should be
 * JSON-serializable for every production adapter.
 *
 * @public
 */
interface DurableRecord<Value = unknown> {
  readonly value: Value;
  readonly version: Version;
}
/**
 * A lease and its fencing token. Pass the complete value returned by
 * `DurableStore.acquire`, `renew`, or a successful renewal back to later calls.
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
 * Lease timing options. The adapter supplies its configured default when this
 * value is omitted.
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
 * A lease acquisition result. Acquisition and the first snapshot read happen
 * in one linearizable operation.
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
  readonly retryAt: number;
};
/**
 * A lease renewal result.
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
 * The namespace used by durable idempotency records.
 *
 * @public
 */
type DedupeKind = 'command' | 'event';
/**
 * A request to claim a command or event id. `digest` must identify the full
 * logical request, not only its caller-generated id.
 *
 * @public
 */
interface DedupeClaimInput {
  readonly lease: Lease;
  readonly kind: DedupeKind;
  readonly id: string;
  readonly digest: string;
  readonly request?: unknown;
}
/**
 * The result of a durable command or event claim.
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
  readonly status: 'completed';
  readonly digest: string;
  readonly result: unknown;
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
} | {
  readonly ok: false;
  readonly code: 'DEDUPLICATE_CONFLICT';
  readonly existingDigest: string;
};
/**
 * The durable completion marker for a previously claimed command or event.
 * It is applied atomically with the snapshot passed to `DurableStore.commit`.
 *
 * @public
 */
interface DedupeCompletion {
  readonly kind: DedupeKind;
  readonly id: string;
  readonly digest: string;
  readonly claimId: string;
  readonly result: unknown;
}
/**
 * The identity of a claimed timer. The expected version prevents an old timer
 * callback from claiming a timer that was removed or replaced by a later
 * snapshot.
 *
 * @public
 */
interface TimerClaimInput {
  readonly lease: Lease;
  readonly timerId: string;
  readonly dueAt: number;
  readonly expected: Version;
}
/**
 * The result of a durable timer claim.
 *
 * @public
 */
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
/**
 * The durable completion marker for a claimed timer. It is applied atomically
 * with the snapshot passed to `DurableStore.commit`.
 *
 * @public
 */
interface TimerCompletion {
  readonly timerId: string;
  readonly dueAt: number;
  readonly expected: Version;
  readonly claimId: string;
}
/**
 * A compare-and-swap commit. `next`, `completeDedupe`, or `completeTimer` must
 * be supplied. All supplied changes succeed or none of them are persisted.
 *
 * @public
 */
interface CommitInput {
  readonly lease: Lease;
  readonly expected: Version | null;
  readonly next?: DurableRecord;
  readonly completeDedupe?: DedupeCompletion;
  readonly completeTimer?: TimerCompletion;
}
/**
 * The result of a compare-and-swap commit.
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
 * Retention limits for coordination metadata. Snapshot rows are not removed by
 * this hook because their lifecycle belongs to the host application.
 *
 * @public
 */
interface RetentionPolicy {
  readonly completedDedupeMs: number;
  readonly timerClaimMs: number;
}
/**
 * Controls one retention pass. `limit` bounds total metadata removals.
 *
 * @public
 */
interface RetentionSweepOptions {
  readonly limit?: number;
}
/**
 * Counts removed coordination records from a retention pass.
 *
 * @public
 */
interface RetentionSweepResult {
  readonly dedupeRemoved: number;
  readonly timerClaimsRemoved: number;
}
/**
 * The storage and coordination contract. Every mutating operation is required
 * to be linearizable by an adapter. It does not attach to `FlowRun`, execute
 * tasks, or define the runtime commit barrier.
 *
 * @public
 */
interface DurableStore {
  /** Acquire a key lease and read its current record atomically. */
  acquire(key: string, ownerId: string, options?: LeaseOptions): Promise<AcquireLeaseResult>;
  /** Read a record without acquiring a lease. */
  read(key: string): Promise<DurableRecord | null>;
  /** Extend a still-live lease without changing its fence. */
  renew(lease: Lease, options?: LeaseOptions): Promise<RenewLeaseResult>;
  /** Release the current lease if the fence still matches. */
  release(lease: Lease): Promise<ReleaseLeaseResult>;
  /** Compare and swap a record and optional completion markers atomically. */
  commit(input: CommitInput): Promise<CommitResult>;
  /** Claim a command or event id, or replay its completed result. */
  claimDedupe(input: DedupeClaimInput): Promise<DedupeClaimResult>;
  /** Claim one due timer for the expected snapshot version. */
  claimTimer(input: TimerClaimInput): Promise<TimerClaimResult>;
  /** Remove expired coordination metadata. Snapshot records remain intact. */
  sweep(options?: RetentionSweepOptions): Promise<RetentionSweepResult>;
}
/**
 * Codes thrown for malformed input or an in-memory serialization failure.
 * Expected races use the typed result unions instead.
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
/**
 * Options for the test adapter. Its clock is read inside each operation, so a
 * mutable clock can exercise expiry and retention without sleeping.
 *
 * @public
 */
interface MemoryDurableStoreOptions {
  readonly now?: () => number;
  readonly leaseTtlMs?: number;
  readonly timerClaimTtlMs?: number;
  readonly retention?: RetentionPolicy;
}
/**
 * The in-memory implementation adds inspection helpers while retaining the
 * exact `DurableStore` contract.
 *
 * @public
 */
interface MemoryDurableStore extends DurableStore {
  /** Return the keys that have acquired a lease or stored metadata. */
  keys(): readonly string[];
  /** Remove all rows and coordination metadata. */
  clear(): void;
}
//#endregion
//#region src/durable-run.d.ts
type HostFailureCode = 'LEASE_LOST' | 'CAS_CONFLICT' | 'TIMER_CLAIM_LOST';
/** Lease and host options shared by durable creation and resume. */
interface DurableHostOptions {
  readonly store: DurableStore;
  readonly key: string;
  readonly ownerId: string;
  readonly lease?: LeaseOptions;
  readonly renewEveryMs?: number;
  readonly onLeaseLost?: (code: HostFailureCode) => void;
}
/**
 * Options for a durable run. An existing record is resumed automatically.
 *
 * @public
 */
type DurableRunOptions<F extends AnyFlow> = Omit<RunOptions<F>, 'store' | 'key' | 'autoSave' | 'beforeEffects' | 'beforeTimer'> & DurableHostOptions;
/**
 * Options for resuming an already persisted durable run.
 *
 * @public
 */
type DurableResumeOptions<F extends AnyFlow> = Omit<ResumeOptions<F>, 'store' | 'key' | 'autoSave' | 'beforeEffects' | 'beforeTimer'> & DurableHostOptions;
/**
 * Options for a caller-supplied command idempotency key.
 *
 * @public
 */
interface DurableCommandOptions {
  readonly commandId: string;
  readonly digest?: string;
  readonly expectedVersion?: Version;
}
/**
 * Options for a caller-supplied event idempotency key.
 *
 * @public
 */
interface DurableEventOptions {
  readonly eventId: string;
  readonly digest?: string;
  readonly expectedVersion?: Version;
  readonly correlationId?: string;
}
/**
 * Failure codes returned by durable command and event helpers.
 *
 * @public
 */
type DurableRunFailureCode = 'LEASE_LOST' | 'CAS_CONFLICT' | 'DEDUPLICATE_CONFLICT' | 'COMMAND_PENDING' | 'EVENT_PENDING';
/**
 * Result of opening a durable run. A busy key is a value, not an exception.
 *
 * @public
 */
type DurableRunOpenResult<F extends AnyFlow> = {
  readonly ok: true;
  readonly host: DurableRunHost<F>;
} | {
  readonly ok: false;
  readonly code: 'LEASE_BUSY';
  readonly retryAt: number;
} | {
  readonly ok: false;
  readonly code: 'RUN_NOT_FOUND';
} | {
  readonly ok: false;
  readonly code: 'LEASE_LOST';
};
/**
 * Result of a deduplicated durable command.
 *
 * @public
 */
type DurableCommandResult = {
  readonly ok: true;
  readonly status: 'applied' | 'replayed';
  readonly result: CommandResult;
  readonly version: Version;
} | {
  readonly ok: false;
  readonly code: DurableRunFailureCode;
  readonly actual?: Version | null;
  readonly claimId?: string;
};
/**
 * Result of a deduplicated durable event.
 *
 * @public
 */
type DurableEventResult = {
  readonly ok: true;
  readonly status: 'applied' | 'replayed';
  readonly result: SendResult;
  readonly version: Version;
} | {
  readonly ok: false;
  readonly code: DurableRunFailureCode;
  readonly actual?: Version | null;
  readonly claimId?: string;
};
/**
 * A `FlowRun` plus the lease, CAS, dedupe, and timer gates needed by a
 * multi-owner host. Use `run` for local control; use `dispatch` and `send` for
 * external commands and events so their ids and expected versions are checked.
 *
 * The host remains at-least-once. It cannot make an external task effect
 * exactly once.
 *
 * @public
 */
interface DurableRunHost<F extends AnyFlow> {
  readonly run: FlowRun<F>;
  readonly lease: Lease;
  readonly version: Version;
  renew(options?: LeaseOptions): Promise<RenewLeaseResult>;
  dispatch(command: Command<F>, options: DurableCommandOptions): Promise<DurableCommandResult>;
  send<E extends EventType<F>>(event: E, payload: unknown, options: DurableEventOptions): Promise<DurableEventResult>;
  claimTimer(timerId: string, dueAt: number, expected?: Version): Promise<TimerClaimResult>;
  release(): Promise<ReleaseLeaseResult>;
  dispose(): Promise<void>;
}
/**
 * Acquire a durable lease and create or resume its `FlowRun`.
 *
 * The normal `createRun` API and core `Store` are unchanged. This helper turns
 * every committed root snapshot into a fenced CAS write before planned effects
 * run, and claims core timers before they enqueue fire messages.
 *
 * @public
 */
declare function createDurableRun<F extends AnyFlow>(flow: F, options: DurableRunOptions<F>): Promise<DurableRunOpenResult<F>>;
/**
 * Acquire a durable lease and resume an existing record. It returns
 * `RUN_NOT_FOUND` when the key has no snapshot.
 *
 * @public
 */
declare function resumeDurableRun<F extends AnyFlow>(flow: F, options: DurableResumeOptions<F>): Promise<DurableRunOpenResult<F>>;
//#endregion
//#region src/memory-store.d.ts
/**
 * In-memory `DurableStore` with synchronous linearization points and JSON
 * round trips at every persistence boundary.
 *
 * @public
 */
declare function createMemoryDurableStore(options?: MemoryDurableStoreOptions): MemoryDurableStore;
//#endregion
export { type AcquireLeaseResult, type CommitInput, type CommitResult, type DedupeClaimInput, type DedupeClaimResult, type DedupeCompletion, type DedupeKind, type DurableCommandOptions, type DurableCommandResult, type DurableEventOptions, type DurableEventResult, type DurableRecord, type DurableResultCode, type DurableResumeOptions, type DurableRunFailureCode, type DurableRunHost, type DurableRunOpenResult, type DurableRunOptions, type DurableStore, DurableStoreError, type DurableStoreErrorCode, type FenceToken, type Lease, type LeaseOptions, type MemoryDurableStore, type MemoryDurableStoreOptions, type ReleaseLeaseResult, type RenewLeaseResult, type RetentionPolicy, type RetentionSweepOptions, type RetentionSweepResult, type TimerClaimInput, type TimerClaimResult, type TimerCompletion, type Version, createDurableRun, createMemoryDurableStore, resumeDurableRun };
//# sourceMappingURL=index.d.ts.map