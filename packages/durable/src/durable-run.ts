import type {
  AnyWizard,
  Command,
  CommandResult,
  EventType,
  PayloadInput,
  ResumeOptions,
  Run,
  RunOptions,
  SendResult,
} from '@openwizard/core'
import type {
  DurableStore,
  Lease,
  LeaseOptions,
  ReleaseLeaseResult,
  RenewLeaseResult,
  Version,
} from '@openwizard/durable/store'
import { openDurableRun } from './durable-run-open'
import type { DurableLeaseLossCode } from './durable-run-state'

interface DurableHostOptions {
  readonly store: DurableStore
  readonly key: string
  readonly ownerId: string
  /** Lease TTL for this host. Default: the store's `leaseTtlMs`. */
  readonly lease?: LeaseOptions
  /**
   * How the lease stays alive. Default `{ everyMs: ttlMs / 3 }`: a timer on the run's
   * scheduler renews it in the background (long-lived processes). `'manual'` starts no timer:
   * use it for request-scoped hosts (edge runtimes such as Cloudflare Workers) that open, act,
   * and dispose within one request, and call `host.renew()` when work may outlive the TTL.
   */
  readonly renew?: 'manual' | { readonly everyMs: number }
  /** Called once when the host stops because its lease, CAS, or timer claim was lost. */
  readonly onLeaseLost?: (code: DurableLeaseLossCode) => void
}

/**
 * Core persistence options the host replaces: it commits every snapshot itself, under the
 * lease and before effects run, so there is no auto-save to tune and a failed write stops the
 * host (`onLeaseLost`) instead of reaching `onPersistError`. `redact` stays: it runs on every
 * snapshot before the store sees it, and a takeover owner resumes from the redacted copy.
 */
type HostManagedOption =
  | 'store'
  | 'key'
  | 'autoSave'
  | 'debounceMs'
  | 'onPersistError'
  | 'beforeEffects'
  | 'beforeTimer'

/** Options for a durable run. An existing record is resumed automatically. @public */
export type DurableRunOptions<F extends AnyWizard> = Omit<RunOptions<F>, HostManagedOption> &
  DurableHostOptions

/** Options for resuming an already persisted durable run. @public */
export type DurableResumeOptions<F extends AnyWizard> = Omit<ResumeOptions<F>, HostManagedOption> &
  DurableHostOptions

/**
 * Options for a caller-supplied command idempotency key. `digest` defaults to a
 * stable JSON digest of the command; reusing `commandId` for another command
 * returns `DEDUPLICATE_CONFLICT`.
 *
 * @public
 */
export interface DurableCommandOptions {
  readonly commandId: string
  readonly digest?: string
  /**
   * Reject a new claim with `CAS_CONFLICT` unless the stored version matches. The run checks
   * again after asynchronous parsing; an intervening change records a `STALE` command result.
   * Completed receipts replay before either check.
   */
  readonly expectedVersion?: Version
}

/**
 * Options for an external event. `eventId` is its idempotency key: core records
 * it in the run snapshot, which the host commits under the lease, so a
 * redelivery to any owner returns `duplicate: true`. A payload the event
 * boundary rejects records nothing and can be resent with the same id.
 *
 * @public
 */
export interface DurableEventOptions {
  readonly eventId: string
  readonly correlationId?: string
}

/** Failure codes of the durable gate itself (not of the run). @public */
export type DurableRunFailureCode =
  | 'LEASE_LOST'
  | 'CAS_CONFLICT'
  | 'DEDUPLICATE_CONFLICT'
  | 'COMMAND_PENDING'
  | 'COMMAND_INTERRUPTED'

/**
 * The durable gate refused or lost an operation. `actual` is the stored version
 * on `CAS_CONFLICT`; `claimId` names the claim still in flight on `COMMAND_PENDING`.
 * `COMMAND_INTERRUPTED`: an earlier owner committed the beginning of an asynchronous
 * navigation, then stopped before its final transaction result committed. A result committed
 * with its snapshot always replays; an unfinished applied claim is never run again.
 *
 * @public
 */
export interface DurableHostFailure {
  readonly ok: false
  readonly code: DurableRunFailureCode
  readonly message: string
  readonly actual?: Version | null
  readonly claimId?: string
}

/** Why a durable run could not be opened. A busy key is a value, not an exception. @public */
export type DurableRunOpenFailure =
  | { readonly ok: false; readonly code: 'LEASE_BUSY'; readonly retryAt: number }
  | { readonly ok: false; readonly code: 'RUN_NOT_FOUND' }
  | { readonly ok: false; readonly code: 'LEASE_LOST' }

/** Result of opening a durable run. @public */
export type DurableRunOpenResult<F extends AnyWizard> =
  | { readonly ok: true; readonly host: DurableRunHost<F> }
  | DurableRunOpenFailure

/**
 * Result of a deduplicated durable command: `applied` now or `replayed` from
 * the stored result of an earlier call with the same id. `result` is the
 * run's own `CommandResult`, which may itself be a rejection.
 *
 * @public
 */
export type DurableCommandResult =
  | {
      readonly ok: true
      readonly status: 'applied' | 'replayed'
      readonly result: CommandResult
      readonly version: Version
    }
  | DurableHostFailure

/**
 * Result of a durable event: the run's `SendResult` (accepted with the
 * committed `version`, `duplicate: true` for a redelivered `eventId`, or the
 * boundary rejection / drop), or a failure of the durable gate.
 *
 * @public
 */
export type DurableEventResult =
  | (Extract<SendResult, { readonly ok: true }> & { readonly version: Version })
  | Extract<SendResult, { readonly ok: false }>
  | DurableHostFailure

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
export interface DurableRunHost<F extends AnyWizard> {
  readonly run: Run<F>
  readonly lease: Lease
  /** The last version committed to the store. */
  readonly version: Version
  /** Extend the lease now. Required with `renew: 'manual'` when work may outlive the TTL. */
  renew(options?: LeaseOptions): Promise<RenewLeaseResult>
  dispatch(command: Command<F>, options: DurableCommandOptions): Promise<DurableCommandResult>
  /** Like `Run.send`: a typed payload must match the event; an `unknown` body is parsed. */
  send<E extends EventType<F>, P>(
    event: E,
    payload: unknown extends P ? P : PayloadInput<F, E>,
    options: DurableEventOptions,
  ): Promise<DurableEventResult>
  /**
   * Stop the run and release the lease once the commands and events already sent to this host
   * have committed. Reports `LEASE_LOST` when the host had already stopped.
   */
  release(): Promise<ReleaseLeaseResult>
  /** Like `release`, but never reports a lost lease. */
  dispose(): Promise<void>
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
export async function createDurableRun<F extends AnyWizard>(
  wizard: F,
  options: DurableRunOptions<F>,
): Promise<DurableRunOpenResult<F>> {
  return openDurableRun(wizard, { kind: 'create', options })
}

/**
 * Acquire a durable lease and resume an existing record. It returns
 * `RUN_NOT_FOUND` when the key has no snapshot.
 *
 * @public
 */
export async function resumeDurableRun<F extends AnyWizard>(
  wizard: F,
  options: DurableResumeOptions<F>,
): Promise<DurableRunOpenResult<F>> {
  return openDurableRun(wizard, { kind: 'resume', options })
}
