import {
  type AnyFlow,
  type Command,
  type CommandResult,
  createRun,
  type EventType,
  type FlowRun,
  type ResumeOptions,
  type RunEvent,
  type RunOptions,
  resumeRun,
  type SendResult,
  type Snapshot,
} from '@openwizard/core'
import {
  type DedupeClaimResult,
  type DurableStore,
  DurableStoreError,
  type Lease,
  type LeaseOptions,
  type ReleaseLeaseResult,
  type RenewLeaseResult,
  type TimerClaimResult,
  type TimerCompletion,
  type Version,
} from './contracts'

const DEFAULT_LEASE_TTL_MS = 30_000

type HostFailureCode = 'LEASE_LOST' | 'CAS_CONFLICT' | 'TIMER_CLAIM_LOST'
type CommitFailureCode =
  | 'LEASE_LOST'
  | 'CAS_CONFLICT'
  | 'INVALID_VERSION'
  | 'DEDUPLICATE_CONFLICT'
  | 'TIMER_CLAIM_LOST'
type BarrierInput<F extends AnyFlow> = {
  readonly snapshot: Snapshot<F>
  readonly events: readonly RunEvent<F>[]
}

/** Lease and host options shared by durable creation and resume. */
interface DurableHostOptions {
  readonly store: DurableStore
  readonly key: string
  readonly ownerId: string
  readonly lease?: LeaseOptions
  readonly renewEveryMs?: number
  readonly onLeaseLost?: (code: HostFailureCode) => void
}

/**
 * Options for a durable run. An existing record is resumed automatically.
 *
 * @public
 */
export type DurableRunOptions<F extends AnyFlow> = Omit<
  RunOptions<F>,
  'store' | 'key' | 'autoSave' | 'beforeEffects' | 'beforeTimer'
> &
  DurableHostOptions

/**
 * Options for resuming an already persisted durable run.
 *
 * @public
 */
export type DurableResumeOptions<F extends AnyFlow> = Omit<
  ResumeOptions<F>,
  'store' | 'key' | 'autoSave' | 'beforeEffects' | 'beforeTimer'
> &
  DurableHostOptions

/**
 * Options for a caller-supplied command idempotency key.
 *
 * @public
 */
export interface DurableCommandOptions {
  readonly commandId: string
  readonly digest?: string
  readonly expectedVersion?: Version
}

/**
 * Options for a caller-supplied event idempotency key.
 *
 * @public
 */
export interface DurableEventOptions {
  readonly eventId: string
  readonly digest?: string
  readonly expectedVersion?: Version
  readonly correlationId?: string
}

/**
 * Failure codes returned by durable command and event helpers.
 *
 * @public
 */
export type DurableRunFailureCode =
  | 'LEASE_LOST'
  | 'CAS_CONFLICT'
  | 'DEDUPLICATE_CONFLICT'
  | 'COMMAND_PENDING'
  | 'EVENT_PENDING'

/**
 * Result of opening a durable run. A busy key is a value, not an exception.
 *
 * @public
 */
export type DurableRunOpenResult<F extends AnyFlow> =
  | { readonly ok: true; readonly host: DurableRunHost<F> }
  | { readonly ok: false; readonly code: 'LEASE_BUSY'; readonly retryAt: number }
  | { readonly ok: false; readonly code: 'RUN_NOT_FOUND' }
  | { readonly ok: false; readonly code: 'LEASE_LOST' }

/**
 * Result of a deduplicated durable command.
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
  | {
      readonly ok: false
      readonly code: DurableRunFailureCode
      readonly actual?: Version | null
      readonly claimId?: string
    }

/**
 * Result of a deduplicated durable event.
 *
 * @public
 */
export type DurableEventResult =
  | {
      readonly ok: true
      readonly status: 'applied' | 'replayed'
      readonly result: SendResult
      readonly version: Version
    }
  | {
      readonly ok: false
      readonly code: DurableRunFailureCode
      readonly actual?: Version | null
      readonly claimId?: string
    }

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
export interface DurableRunHost<F extends AnyFlow> {
  readonly run: FlowRun<F>
  readonly lease: Lease
  readonly version: Version
  renew(options?: LeaseOptions): Promise<RenewLeaseResult>
  dispatch(command: Command<F>, options: DurableCommandOptions): Promise<DurableCommandResult>
  send<E extends EventType<F>>(
    event: E,
    payload: unknown,
    options: DurableEventOptions,
  ): Promise<DurableEventResult>
  claimTimer(timerId: string, dueAt: number, expected?: Version): Promise<TimerClaimResult>
  release(): Promise<ReleaseLeaseResult>
  dispose(): Promise<void>
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
export async function createDurableRun<F extends AnyFlow>(
  flow: F,
  options: DurableRunOptions<F>,
): Promise<DurableRunOpenResult<F>> {
  return openDurableRun(flow, options, false)
}

/**
 * Acquire a durable lease and resume an existing record. It returns
 * `RUN_NOT_FOUND` when the key has no snapshot.
 *
 * @public
 */
export async function resumeDurableRun<F extends AnyFlow>(
  flow: F,
  options: DurableResumeOptions<F>,
): Promise<DurableRunOpenResult<F>> {
  return openDurableRun(flow, options, true)
}

async function openDurableRun<F extends AnyFlow>(
  flow: F,
  options: DurableRunOptions<F> | DurableResumeOptions<F>,
  resumeOnly: boolean,
): Promise<DurableRunOpenResult<F>> {
  const ttlMs = positive(options.lease?.ttlMs ?? DEFAULT_LEASE_TTL_MS, 'lease.ttlMs')
  const renewEveryMs = positive(
    options.renewEveryMs ?? Math.max(1, Math.floor(ttlMs / 3)),
    'renewEveryMs',
  )
  const acquired = await options.store.acquire(options.key, options.ownerId, { ttlMs })
  if (!acquired.ok) return acquired
  if (resumeOnly && acquired.record === null) {
    await options.store.release(acquired.lease)
    return { ok: false, code: 'RUN_NOT_FOUND' }
  }

  let currentLease = acquired.lease
  let persistedVersion = acquired.record?.version ?? null
  let publicVersion = acquired.record?.version ?? { epoch: 0, seq: 0 }
  let stopped = false
  let run: FlowRun<F> | undefined
  let renewalHandle: unknown
  let pendingTimerClaims: TimerCompletion[] = []
  let barrierTail = Promise.resolve()
  const startupBarriers: Promise<void>[] = []

  const scheduler = options.scheduler ?? nativeScheduler
  const stopRenewal = (): void => {
    if (renewalHandle === undefined) return
    scheduler.clearTimeout(renewalHandle)
    renewalHandle = undefined
  }
  const notifyLeaseLost = (code: HostFailureCode): void => {
    try {
      options.onLeaseLost?.(code)
    } catch {
      // A lease-loss observer cannot keep a stopped run alive.
    }
  }
  const stop = (): void => {
    if (stopped) return
    stopped = true
    pendingTimerClaims = []
    stopRenewal()
    run?.dispose()
  }
  const markLost = (code: HostFailureCode): void => {
    if (stopped) return
    stop()
    notifyLeaseLost(code)
  }

  const renewLease = async (renewOptions?: LeaseOptions): Promise<RenewLeaseResult> => {
    if (stopped) return { ok: false, code: 'LEASE_LOST' }
    try {
      const renewed = await options.store.renew(currentLease, renewOptions ?? { ttlMs })
      if (!renewed.ok) markLost('LEASE_LOST')
      else currentLease = renewed.lease
      return renewed
    } catch {
      markLost('LEASE_LOST')
      return { ok: false, code: 'LEASE_LOST' }
    }
  }

  const scheduleRenewal = (): void => {
    if (stopped) return
    renewalHandle = scheduler.setTimeout(() => {
      renewalHandle = undefined
      void renewLease().then(
        () => scheduleRenewal(),
        () => undefined,
      )
    }, renewEveryMs)
  }

  const rememberTimerClaim = (claim: TimerCompletion): void => {
    if (
      pendingTimerClaims.some(
        (existing) =>
          existing.timerId === claim.timerId &&
          existing.claimId === claim.claimId &&
          existing.dueAt === claim.dueAt &&
          sameVersion(existing.expected, claim.expected),
      )
    ) {
      return
    }
    pendingTimerClaims.push(claim)
  }

  const beforeTimer = async (timer: {
    readonly timerId: string
    readonly dueAt: number
    readonly expected: Version
  }): Promise<boolean> => {
    if (stopped) return false
    try {
      const claimed = await options.store.claimTimer({
        lease: currentLease,
        timerId: timer.timerId,
        dueAt: timer.dueAt,
        expected: timer.expected,
      })
      if (!claimed.ok) {
        if (claimed.code === 'LEASE_LOST') markLost('LEASE_LOST')
        else if (
          claimed.code === 'TIMER_ALREADY_CLAIMED' &&
          claimed.ownerFence === currentLease.fence
        ) {
          rememberTimerClaim({
            timerId: timer.timerId,
            dueAt: timer.dueAt,
            expected: timer.expected,
            claimId: claimed.claimId,
          })
          return true
        }
        return false
      }
      rememberTimerClaim({
        timerId: claimed.timerId,
        dueAt: claimed.dueAt,
        expected: claimed.expected,
        claimId: claimed.claimId,
      })
      return true
    } catch {
      markLost('LEASE_LOST')
      return false
    }
  }

  const persistSnapshot = async (input: BarrierInput<F>): Promise<void> => {
    if (stopped) return
    const nextVersion: Version = { epoch: input.snapshot.epoch, seq: input.snapshot.seq }
    const timerEvent = input.events.find((event) => event.type === 'timer.fired')
    const timerCompletion =
      timerEvent === undefined || !('timerId' in timerEvent)
        ? undefined
        : takeTimerClaim(pendingTimerClaims, timerEvent.timerId)
    try {
      const committed = await options.store.commit({
        lease: currentLease,
        expected: persistedVersion,
        next: { value: input.snapshot, version: nextVersion },
        ...(timerCompletion === undefined ? {} : { completeTimer: timerCompletion }),
      })
      if (!committed.ok) {
        markLost(commitFailureCode(committed.code))
        return
      }
      persistedVersion = nextVersion
      publicVersion = nextVersion
    } catch {
      markLost('LEASE_LOST')
    }
  }

  const beforeEffects = (input: BarrierInput<F>): Promise<void> => {
    const next = barrierTail.then(
      () => persistSnapshot(input),
      () => persistSnapshot(input),
    )
    barrierTail = next.then(
      () => undefined,
      () => undefined,
    )
    if (run === undefined) startupBarriers.push(next)
    return next
  }

  const core = coreOptions(options)
  try {
    if (acquired.record === null) {
      run = createCoreRun(flow, core, options.key, beforeEffects, beforeTimer)
    } else {
      run = resumeCoreRun(flow, core, acquired.record.value, beforeEffects, beforeTimer)
    }
  } catch (error) {
    stop()
    await options.store.release(currentLease)
    throw error
  }

  if (acquired.record === null) {
    let initial:
      | { readonly ok: true; readonly version: Version }
      | { readonly ok: false; readonly code: CommitFailureCode }
    try {
      initial = await persistInitialSnapshot(options.store, currentLease, run.getSnapshot())
    } catch {
      markLost('LEASE_LOST')
      await options.store.release(currentLease)
      return { ok: false, code: 'LEASE_LOST' }
    }
    if (!initial.ok) {
      markLost(commitFailureCode(initial.code))
      await options.store.release(currentLease)
      return { ok: false, code: 'LEASE_LOST' }
    }
    persistedVersion = initial.version
    publicVersion = initial.version
  } else {
    await Promise.all(startupBarriers)
  }
  if (stopped) {
    await options.store.release(currentLease)
    return { ok: false, code: 'LEASE_LOST' }
  }

  const host = makeHost({
    run,
    getLease: () => currentLease,
    getVersion: () => publicVersion,
    getPersistedVersion: () => persistedVersion,
    awaitBarriers: () => barrierTail,
    store: options.store,
    renewLease,
    markLost,
    stop,
    stopRenewal,
    isStopped: () => stopped,
    getTimerClaims: () => pendingTimerClaims,
    setTimerClaims: (claims) => {
      pendingTimerClaims = claims
    },
  })
  scheduleRenewal()
  return { ok: true, host }
}

interface HostState<F extends AnyFlow> {
  readonly run: FlowRun<F>
  readonly getLease: () => Lease
  readonly getVersion: () => Version
  readonly getPersistedVersion: () => Version | null
  readonly awaitBarriers: () => Promise<void>
  readonly store: DurableStore
  readonly renewLease: (options?: LeaseOptions) => Promise<RenewLeaseResult>
  readonly markLost: (code: HostFailureCode) => void
  readonly stop: () => void
  readonly stopRenewal: () => void
  readonly isStopped: () => boolean
  readonly getTimerClaims: () => TimerCompletion[]
  readonly setTimerClaims: (claims: TimerCompletion[]) => void
}

function makeHost<F extends AnyFlow>(state: HostState<F>): DurableRunHost<F> {
  let operation = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = operation.then(work, work)
    operation = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const expectedFailure = (code: DurableRunFailureCode, actual?: Version | null) => ({
    ok: false as const,
    code,
    ...(actual === undefined ? {} : { actual }),
  })

  const host: DurableRunHost<F> = {
    run: state.run,
    get lease() {
      return copyLease(state.getLease())
    },
    get version() {
      return copyVersion(state.getVersion())
    },
    renew: (options) => state.renewLease(options),
    dispatch(command, options) {
      return serialize(async () => {
        if (state.isStopped()) return expectedFailure('LEASE_LOST')
        const actual = state.getPersistedVersion()
        if (
          options.expectedVersion !== undefined &&
          !sameVersion(actual, options.expectedVersion)
        ) {
          return expectedFailure('CAS_CONFLICT', actual)
        }
        const digest = options.digest ?? digestOf({ command })
        const claim = await state.store.claimDedupe({
          lease: state.getLease(),
          kind: 'command',
          id: options.commandId,
          digest,
          request: command,
        })
        const claimed = claimForCommand(claim)
        if (claimed.kind === 'failure') return claimed.value
        if (claimed.kind === 'replayed') {
          return {
            ok: true,
            status: 'replayed',
            result: claimed.result,
            version: copyVersion(state.getVersion()),
          }
        }
        const result = await state.run.dispatch(command)
        if (state.isStopped()) return expectedFailure('LEASE_LOST')
        const completed = await completeDedupe(state, {
          kind: 'command',
          id: options.commandId,
          digest,
          claimId: claimed.claimId,
          result,
        })
        if (!completed.ok) return completed
        return { ok: true, status: 'applied', result, version: copyVersion(state.getVersion()) }
      })
    },
    send(event, payload, options) {
      return serialize(async () => {
        if (state.isStopped()) return expectedFailure('LEASE_LOST')
        const actual = state.getPersistedVersion()
        if (
          options.expectedVersion !== undefined &&
          !sameVersion(actual, options.expectedVersion)
        ) {
          return expectedFailure('CAS_CONFLICT', actual)
        }
        const digest =
          options.digest ??
          digestOf({
            event,
            payload,
            ...(options.correlationId === undefined
              ? {}
              : { correlationId: options.correlationId }),
          })
        const claim = await state.store.claimDedupe({
          lease: state.getLease(),
          kind: 'event',
          id: options.eventId,
          digest,
          request: { event, payload },
        })
        const claimed = claimForEvent(claim)
        if (claimed.kind === 'failure') return claimed.value
        if (claimed.kind === 'replayed') {
          return {
            ok: true,
            status: 'replayed',
            result: claimed.result,
            version: copyVersion(state.getVersion()),
          }
        }
        const result = await state.run.send(event, payload, {
          ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
        })
        if (state.isStopped()) return expectedFailure('LEASE_LOST')
        const completed = await completeDedupe(state, {
          kind: 'event',
          id: options.eventId,
          digest,
          claimId: claimed.claimId,
          result,
        })
        if (!completed.ok) return completed
        return { ok: true, status: 'applied', result, version: copyVersion(state.getVersion()) }
      })
    },
    claimTimer(timerId, dueAt, expected = state.getVersion()) {
      return serialize(async () => {
        if (state.isStopped()) return { ok: false, code: 'LEASE_LOST' }
        try {
          const result = await state.store.claimTimer({
            lease: state.getLease(),
            timerId,
            dueAt,
            expected,
          })
          if (result.ok) {
            state.setTimerClaims([
              ...state.getTimerClaims(),
              {
                timerId: result.timerId,
                dueAt: result.dueAt,
                expected: result.expected,
                claimId: result.claimId,
              },
            ])
          }
          if (!result.ok && result.code === 'LEASE_LOST') state.markLost('LEASE_LOST')
          return result
        } catch {
          state.markLost('LEASE_LOST')
          return { ok: false, code: 'LEASE_LOST' }
        }
      })
    },
    async release() {
      if (state.isStopped()) return { ok: false, code: 'LEASE_LOST' }
      state.stopRenewal()
      state.stop()
      await state.awaitBarriers()
      return state.store.release(state.getLease())
    },
    async dispose() {
      const wasStopped = state.isStopped()
      state.stopRenewal()
      state.stop()
      await state.awaitBarriers()
      if (!wasStopped) await state.store.release(state.getLease())
    },
  }
  return host
}

type DedupeCompletionOutcome =
  | { readonly ok: true; readonly version: Version }
  | {
      readonly ok: false
      readonly code: DurableRunFailureCode
      readonly actual?: Version | null
    }

async function completeDedupe(
  state: Pick<
    HostState<AnyFlow>,
    'store' | 'getLease' | 'getPersistedVersion' | 'getVersion' | 'awaitBarriers' | 'markLost'
  >,
  completion: {
    readonly kind: 'command' | 'event'
    readonly id: string
    readonly digest: string
    readonly claimId: string
    readonly result: CommandResult | SendResult
  },
): Promise<DedupeCompletionOutcome> {
  // A command may resolve before an asynchronous task result reaches the core queue. Let all
  // barriers currently visible to this host finish before publishing the dedupe result. The
  // metadata-only commit is intentionally still separate: a crash in this window may replay.
  await state.awaitBarriers()
  let committed: Awaited<ReturnType<DurableStore['commit']>>
  try {
    committed = await state.store.commit({
      lease: state.getLease(),
      expected: state.getPersistedVersion(),
      completeDedupe: completion,
    })
  } catch {
    state.markLost('LEASE_LOST')
    return { ok: false, code: 'LEASE_LOST' }
  }
  if (!committed.ok) {
    if (committed.code === 'LEASE_LOST') state.markLost('LEASE_LOST')
    else if (committed.code === 'CAS_CONFLICT') state.markLost('CAS_CONFLICT')
    return {
      ok: false,
      code: dedupeFailureCode(committed.code),
      ...(committed.code === 'CAS_CONFLICT' ? { actual: committed.actual } : {}),
    }
  }
  return { ok: true, version: copyVersion(state.getVersion()) }
}

function claimForCommand(
  claim: DedupeClaimResult,
):
  | { readonly kind: 'claimed'; readonly claimId: string }
  | { readonly kind: 'replayed'; readonly result: CommandResult }
  | { readonly kind: 'failure'; readonly value: DurableCommandResult } {
  if (!claim.ok) {
    if (claim.code === 'LEASE_LOST')
      return { kind: 'failure', value: { ok: false, code: 'LEASE_LOST' } }
    return { kind: 'failure', value: { ok: false, code: 'DEDUPLICATE_CONFLICT' } }
  }
  if (claim.status === 'completed')
    return { kind: 'replayed', result: claim.result as CommandResult }
  if (claim.status === 'pending') {
    return {
      kind: 'failure',
      value: { ok: false, code: 'COMMAND_PENDING', claimId: claim.claimId },
    }
  }
  return { kind: 'claimed', claimId: claim.claimId }
}

function claimForEvent(
  claim: DedupeClaimResult,
):
  | { readonly kind: 'claimed'; readonly claimId: string }
  | { readonly kind: 'replayed'; readonly result: SendResult }
  | { readonly kind: 'failure'; readonly value: DurableEventResult } {
  if (!claim.ok) {
    if (claim.code === 'LEASE_LOST')
      return { kind: 'failure', value: { ok: false, code: 'LEASE_LOST' } }
    return { kind: 'failure', value: { ok: false, code: 'DEDUPLICATE_CONFLICT' } }
  }
  if (claim.status === 'completed') return { kind: 'replayed', result: claim.result as SendResult }
  if (claim.status === 'pending') {
    return { kind: 'failure', value: { ok: false, code: 'EVENT_PENDING', claimId: claim.claimId } }
  }
  return { kind: 'claimed', claimId: claim.claimId }
}

function takeTimerClaim(claims: TimerCompletion[], timerId: string): TimerCompletion | undefined {
  const index = claims.findIndex((claim) => claim.timerId === timerId)
  if (index < 0) return undefined
  const [claim] = claims.splice(index, 1)
  return claim
}

function coreOptions<F extends AnyFlow>(
  options: DurableRunOptions<F> | DurableResumeOptions<F>,
): Record<string, unknown> {
  const {
    store: _store,
    key: _key,
    ownerId: _ownerId,
    lease: _lease,
    renewEveryMs: _renewEveryMs,
    onLeaseLost: _onLeaseLost,
    ...rest
  } = options
  return rest
}

function createCoreRun<F extends AnyFlow>(
  flow: F,
  options: Record<string, unknown>,
  key: string,
  beforeEffects: (input: BarrierInput<F>) => Promise<void>,
  beforeTimer: (timer: {
    readonly timerId: string
    readonly dueAt: number
    readonly expected: Version
  }) => Promise<boolean>,
): FlowRun<F> {
  return createRun(flow, {
    ...options,
    instanceId: (options.instanceId as string | undefined) ?? key,
    beforeEffects,
    beforeTimer,
  } as unknown as RunOptions<F>)
}

function resumeCoreRun<F extends AnyFlow>(
  flow: F,
  options: Record<string, unknown>,
  snapshot: unknown,
  beforeEffects: (input: BarrierInput<F>) => Promise<void>,
  beforeTimer: (timer: {
    readonly timerId: string
    readonly dueAt: number
    readonly expected: Version
  }) => Promise<boolean>,
): FlowRun<F> {
  return resumeRun(flow, snapshot, {
    ...options,
    beforeEffects,
    beforeTimer,
  } as unknown as ResumeOptions<F>)
}

function positive(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      `${name} must be a finite number greater than 0`,
    )
  }
  return value
}

function sameVersion(left: Version | null, right: Version): boolean {
  return left !== null && left.epoch === right.epoch && left.seq === right.seq
}

function copyVersion(version: Version): Version {
  return { epoch: version.epoch, seq: version.seq }
}

function copyLease(lease: Lease): Lease {
  return { ...lease }
}

function digestOf(value: unknown): string {
  return `json:${stableJson(value, new Set())}`
}

function stableJson(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value !== 'object')
    throw new DurableStoreError('NOT_SERIALIZABLE', 'digest input is not JSON-serializable')
  if (seen.has(value)) throw new DurableStoreError('NOT_SERIALIZABLE', 'digest input is circular')
  seen.add(value)
  let result: string
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => stableJson(entry, seen)).join(',')}]`
  } else {
    const object = value as Record<string, unknown>
    result = `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key], seen)}`)
      .join(',')}}`
  }
  seen.delete(value)
  return result
}

function commitFailureCode(code: CommitFailureCode): HostFailureCode {
  if (code === 'TIMER_CLAIM_LOST') return 'TIMER_CLAIM_LOST'
  if (code === 'CAS_CONFLICT' || code === 'INVALID_VERSION') return 'CAS_CONFLICT'
  return 'LEASE_LOST'
}

function dedupeFailureCode(code: CommitFailureCode): DurableRunFailureCode {
  if (code === 'DEDUPLICATE_CONFLICT') return 'DEDUPLICATE_CONFLICT'
  if (code === 'CAS_CONFLICT' || code === 'INVALID_VERSION') return 'CAS_CONFLICT'
  return 'LEASE_LOST'
}

async function persistInitialSnapshot<F extends AnyFlow>(
  store: DurableStore,
  lease: Lease,
  snapshot: Snapshot<F>,
): Promise<
  | { readonly ok: true; readonly version: Version }
  | { readonly ok: false; readonly code: CommitFailureCode }
> {
  const committed = await store.commit({
    lease,
    expected: null,
    next: {
      value: snapshot,
      version: { epoch: snapshot.epoch, seq: snapshot.seq },
    },
  })
  if (!committed.ok) return committed
  return committed.version === null
    ? { ok: false, code: 'INVALID_VERSION' }
    : { ok: true, version: committed.version }
}

const nativeScheduler = {
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(fn, ms)
  },
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}
