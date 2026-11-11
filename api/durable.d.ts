import { DurableStore, Lease, LeaseOptions, ReleaseLeaseResult, RenewLeaseResult, RetentionPolicy, Version } from "@openwizard/durable/store";
import { AnyWizard, Command, CommandResult, ContextInput, DepsOf, EventType, PayloadInput, RequiredDepsOf, ResumeOptions, Run, RunOptions, SendResult } from "@openwizard/core";
//#region src/durable-run-state.d.ts
/** Why a durable host stopped on its own: its lease, snapshot CAS, or a timer claim was lost. @public */
type DurableLeaseLossCode = 'LEASE_LOST' | 'CAS_CONFLICT' | 'TIMER_CLAIM_LOST';
//#endregion
//#region src/durable-run.d.ts
interface DurableHostOptions$1 {
  readonly store: DurableStore;
  readonly key: string;
  readonly ownerId: string;
  /** Lease TTL for this host. Default: the store's `leaseTtlMs`. */
  readonly lease?: LeaseOptions;
  /**
   * How the lease stays alive. Default `{ everyMs: ttlMs / 3 }`: a timer on the run's
   * scheduler renews it in the background (long-lived processes). `'manual'` starts no timer:
   * use it for request-scoped hosts (edge runtimes such as Cloudflare Workers) that open, act,
   * and dispose within one request, and call `host.renew()` when work may outlive the TTL.
   */
  readonly renew?: 'manual' | {
    readonly everyMs: number;
  };
  /** Called once when the host stops because its lease, CAS, or timer claim was lost. */
  readonly onLeaseLost?: (code: DurableLeaseLossCode) => void;
}
/**
 * Core persistence options the host replaces: it commits every snapshot itself, under the
 * lease and before effects run, so there is no auto-save to tune and a failed write stops the
 * host (`onLeaseLost`) instead of reaching `onPersistError`. `redact` stays: it runs on every
 * snapshot before the store sees it, and a takeover owner resumes from the redacted copy.
 */
type HostManagedOption = 'store' | 'key' | 'autoSave' | 'debounceMs' | 'onPersistError' | 'beforeEffects' | 'beforeTimer';
/** Options for a durable run. An existing record is resumed automatically. @public */
type DurableRunOptions<F extends AnyWizard> = Omit<RunOptions<F>, HostManagedOption> & DurableHostOptions$1;
/** Options for resuming an already persisted durable run. @public */
type DurableResumeOptions<F extends AnyWizard> = Omit<ResumeOptions<F>, HostManagedOption> & DurableHostOptions$1;
/**
 * Options for a caller-supplied command idempotency key. `digest` defaults to a
 * stable JSON digest of the command; reusing `commandId` for another command
 * returns `DEDUPLICATE_CONFLICT`.
 *
 * @public
 */
interface DurableCommandOptions {
  readonly commandId: string;
  readonly digest?: string;
  /**
   * Reject a new claim with `CAS_CONFLICT` unless the stored version matches. The run checks
   * again after asynchronous parsing; an intervening change records a `STALE` command result.
   * Completed receipts replay before either check.
   */
  readonly expectedVersion?: Version;
}
/**
 * Options for an external event. `eventId` is its idempotency key: core records
 * it in the run snapshot, which the host commits under the lease, so a
 * redelivery to any owner returns `duplicate: true`. A payload the event
 * boundary rejects records nothing and can be resent with the same id.
 *
 * @public
 */
interface DurableEventOptions {
  readonly eventId: string;
  readonly correlationId?: string;
}
/** Failure codes of the durable gate itself (not of the flow). @public */
type DurableRunFailureCode = 'LEASE_LOST' | 'CAS_CONFLICT' | 'DEDUPLICATE_CONFLICT' | 'COMMAND_PENDING' | 'COMMAND_INTERRUPTED';
/**
 * The durable gate refused or lost an operation. `actual` is the stored version
 * on `CAS_CONFLICT`; `claimId` names the claim still in flight on `COMMAND_PENDING`.
 * `COMMAND_INTERRUPTED`: an earlier owner committed the beginning of an asynchronous
 * navigation, then stopped before its final transaction result committed. A result committed
 * with its snapshot always replays; an unfinished applied claim is never run again.
 *
 * @public
 */
interface DurableHostFailure {
  readonly ok: false;
  readonly code: DurableRunFailureCode;
  readonly message: string;
  readonly actual?: Version | null;
  readonly claimId?: string;
}
/** Why a durable run could not be opened. A busy key is a value, not an exception. @public */
type DurableRunOpenFailure = {
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
/** Result of opening a durable run. @public */
type DurableRunOpenResult<F extends AnyWizard> = {
  readonly ok: true;
  readonly host: DurableRunHost<F>;
} | DurableRunOpenFailure;
/**
 * Result of a deduplicated durable command: `applied` now or `replayed` from
 * the stored result of an earlier call with the same id. `result` is the
 * flow's own `CommandResult`, which may itself be a rejection.
 *
 * @public
 */
type DurableCommandResult = {
  readonly ok: true;
  readonly status: 'applied' | 'replayed';
  readonly result: CommandResult;
  readonly version: Version;
} | DurableHostFailure;
/**
 * Result of a durable event: the flow's `SendResult` (accepted with the
 * committed `version`, `duplicate: true` for a redelivered `eventId`, or the
 * boundary rejection / drop), or a failure of the durable gate.
 *
 * @public
 */
type DurableEventResult = (Extract<SendResult, {
  readonly ok: true;
}> & {
  readonly version: Version;
}) | Extract<SendResult, {
  readonly ok: false;
}> | DurableHostFailure;
/**
 * A `Run` plus the lease, CAS, dedupe, and timer gates needed by a
 * multi-owner host. Use `run` for local control; use `dispatch` and `send` for
 * external commands and events so their ids are checked.
 *
 * The host remains at-least-once. It cannot make an external task effect
 * exactly once.
 *
 * @public
 */
interface DurableRunHost<F extends AnyWizard> {
  readonly run: Run<F>;
  readonly lease: Lease;
  /** The last version committed to the store. */
  readonly version: Version;
  /** Extend the lease now. Required with `renew: 'manual'` when work may outlive the TTL. */
  renew(options?: LeaseOptions): Promise<RenewLeaseResult>;
  dispatch(command: Command<F>, options: DurableCommandOptions): Promise<DurableCommandResult>;
  /** Like `Run.send`: a typed payload must match the event; an `unknown` body is parsed. */
  send<E extends EventType<F>, P>(event: E, payload: unknown extends P ? P : PayloadInput<F, E>, options: DurableEventOptions): Promise<DurableEventResult>;
  /**
   * Stop the run and release the lease once the commands and events already sent to this host
   * have committed. Reports `LEASE_LOST` when the host had already stopped.
   */
  release(): Promise<ReleaseLeaseResult>;
  /** Like `release`, but never reports a lost lease. */
  dispose(): Promise<void>;
}
/**
 * Acquire a durable lease and create or resume a run of the wizard.
 *
 * This helper uses the wizard's bound creators, including dependencies supplied by `provide()`.
 * It turns every committed root snapshot into a fenced CAS write before planned effects
 * run, and claims core timers before they enqueue fire messages.
 *
 * @public
 */
declare function createDurableRun<F extends AnyWizard>(flow: F, options: DurableRunOptions<F>): Promise<DurableRunOpenResult<F>>;
/**
 * Acquire a durable lease and resume an existing record. It returns
 * `RUN_NOT_FOUND` when the key has no snapshot.
 *
 * @public
 */
declare function resumeDurableRun<F extends AnyWizard>(flow: F, options: DurableResumeOptions<F>): Promise<DurableRunOpenResult<F>>;
//#endregion
//#region src/host-registry.d.ts
/**
 * The result returned by a host opener. Expected open failures stay in the
 * caller-defined `E` branch.
 *
 * @public
 */
type HostOpenResult<T, E extends {
  readonly ok: false;
}> = {
  readonly ok: true;
  readonly value: T;
} | E;
/**
 * Lifecycle controls for one host generation. The signal aborts when that
 * generation is invalidated, evicted, or disposed. `invalidate` only removes
 * the generation opened with this context, so an old lease-loss callback
 * cannot remove its replacement.
 *
 * @public
 */
interface HostOpenContext {
  readonly signal: AbortSignal;
  invalidate(): void;
}
/**
 * Returned when an open loses a race with registry disposal or starts after
 * disposal.
 *
 * @public
 */
interface HostRegistryDisposed {
  readonly ok: false;
  readonly code: 'HOST_REGISTRY_DISPOSED';
}
/**
 * The result returned by `createHostRegistry().open`. The registry adds its
 * own disposed failure without manufacturing the caller-defined `E`.
 *
 * @public
 */
type HostRegistryOpenResult<T, E extends {
  readonly ok: false;
}> = HostOpenResult<T, E> | HostRegistryDisposed;
/**
 * Create a keyed host cache that removes entries only through invalidation,
 * expected eviction, or registry disposal. Opens for one key share a promise.
 * Different keys open independently. The registry does not choose keys,
 * discover hosts, retry, or interpret open failures.
 *
 * @public
 */
declare function createHostRegistry<I, T, E extends {
  readonly ok: false;
}>(options: {
  readonly key: (identity: I) => string;
  readonly open: (identity: I, context: HostOpenContext) => Promise<HostOpenResult<T, E>>;
  readonly close: (value: T) => void | PromiseLike<void>;
}): {
  open(identity: I): Promise<HostRegistryOpenResult<T, E>>;
  cached(identity: I): T | undefined;
  values(): readonly T[];
  evict(identity: I, expected: T): Promise<boolean>;
  dispose(): Promise<void>;
};
//#endregion
//#region src/durable-host.d.ts
type HostDeps<F extends AnyWizard> = {} extends RequiredDepsOf<F> ? {
  readonly deps?: (key: string) => Partial<DepsOf<F>>;
} : {
  readonly deps: (key: string) => RequiredDepsOf<F> & Partial<DepsOf<F>>;
};
/**
 * Options of `createDurableHost`: the run options every run shares (scheduler, clock, `redact`,
 * `eventIds`, `migrate`, lease and renewal), plus `deps(key)` for dependencies still required
 * after `wizard.provide()`.
 *
 * @public
 */
type DurableHostOptions<F extends AnyWizard> = Omit<DurableResumeOptions<F>, 'key' | 'ownerId' | 'onLeaseLost' | 'deps'> & {
  /** Written on every lease this host takes. Default: a random id per host. */
  readonly ownerId?: string;
  /** A run's host stopped on its own (lease, CAS, or timer claim lost). The key reopens on use. */
  readonly onLeaseLost?: (key: string, code: DurableLeaseLossCode) => void;
} & HostDeps<F>;
/** Per-run creation options of `DurableHost.create`. @public */
type DurableCreateOptions<F extends AnyWizard> = Pick<RunOptions<F>, 'instanceId' | 'correlationId'>;
/** Why `DurableHost` could not reach a run: open failures plus a disposed host. @public */
type DurableHostOpenFailure = DurableRunOpenFailure | HostRegistryDisposed;
/**
 * Result of `DurableHost.open` / `create`. A returned handle's `send` and `dispatch` reopen
 * its key after automatic lease release. Its `run` belongs to the latest generation that
 * handle used; local run commands and subscriptions last only as long as that lease.
 *
 * @public
 */
type DurableHostOpenResult<F extends AnyWizard> = {
  readonly ok: true;
  readonly host: DurableRunHost<F>;
} | DurableHostOpenFailure;
/**
 * Durable runs of one flow, addressed by key. The host owns each run's lease (renewal, release on
 * a terminal result, reopening after a takeover) and keeps live runs open in memory; every method
 * returns failures as values.
 *
 * @public
 */
interface DurableHost<F extends AnyWizard> {
  /** Create the run at `key` (or resume the one stored there) and keep it open. */
  create(key: string, input: ContextInput<F>, options?: DurableCreateOptions<F>): Promise<DurableHostOpenResult<F>>;
  /** The open run at `key`, resuming it from the store when needed (`RUN_NOT_FOUND` if none). */
  open(key: string): Promise<DurableHostOpenResult<F>>;
  /** `open(key)`, then `send` through its host: a redelivered `eventId` is a duplicate. */
  send<E extends EventType<F>, P>(key: string, event: E, payload: unknown extends P ? P : PayloadInput<F, E>, options: DurableEventOptions): Promise<DurableEventResult | DurableHostOpenFailure>;
  /** `open(key)`, then `dispatch` through its host: a repeated `commandId` replays its result. */
  dispatch(key: string, command: Command<F>, options: DurableCommandOptions): Promise<DurableCommandResult | DurableHostOpenFailure>;
  /** Release every lease once in-flight commands and events commit. Later calls fail. */
  dispose(): Promise<void>;
}
/**
 * Host the durable runs of `flow` on `store`: what a multi-worker service would otherwise build
 * from `createHostRegistry` and `createDurableRun`. A run whose lease is lost is dropped and
 * reopened by the next call for its key. A terminal run releases its lease after in-flight host
 * operations settle. Returned handles can be held across I/O: `send` and `dispatch` reopen on
 * demand and replay persisted ids. A competing owner makes a held handle return `LEASE_LOST`;
 * `open(key)` reports `LEASE_BUSY` with its retry time. Explicitly released handles stay closed.
 *
 * @public
 */
declare function createDurableHost<F extends AnyWizard>(flow: F, options: DurableHostOptions<F>): DurableHost<F>;
//#endregion
//#region src/memory-store.d.ts
/**
 * Options for the in-memory store. Its clock is read inside each operation, so
 * a mutable clock can exercise expiry and retention without sleeping.
 *
 * @public
 */
interface MemoryDurableStoreOptions {
  readonly now?: () => number;
  /** Lease TTL when a caller omits `ttlMs`. Default 30 000 ms. */
  readonly leaseTtlMs?: number;
  /** How long a timer claim blocks other claims. Default 30 000 ms. */
  readonly timerClaimTtlMs?: number;
  /** Default: completed command claims 7 days, timer claims 5 minutes. */
  readonly retention?: RetentionPolicy;
}
/**
 * The in-memory store: the exact `DurableStore` contract plus inspection
 * helpers for tests.
 *
 * @public
 */
interface MemoryDurableStore extends DurableStore {
  /** Return the keys that have acquired a lease or stored metadata. */
  keys(): readonly string[];
  /** Remove all rows and coordination metadata. */
  clear(): void;
}
/**
 * In-memory `DurableStore` with synchronous linearization points and JSON
 * round trips at every persistence boundary. For tests and single-process
 * development.
 *
 * @public
 */
declare function createMemoryDurableStore(options?: MemoryDurableStoreOptions): MemoryDurableStore;
//#endregion
export { type DurableCommandOptions, type DurableCommandResult, type DurableCreateOptions, type DurableEventOptions, type DurableEventResult, type DurableHost, type DurableHostFailure, type DurableHostOpenFailure, type DurableHostOpenResult, type DurableHostOptions, type DurableLeaseLossCode, type DurableResumeOptions, type DurableRunFailureCode, type DurableRunHost, type DurableRunOpenFailure, type DurableRunOpenResult, type DurableRunOptions, type HostOpenContext, type HostOpenResult, type HostRegistryDisposed, type HostRegistryOpenResult, type MemoryDurableStore, type MemoryDurableStoreOptions, createDurableHost, createDurableRun, createHostRegistry, createMemoryDurableStore, resumeDurableRun };
//# sourceMappingURL=index.d.ts.map