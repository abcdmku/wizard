import type { AnyWizard, Run } from '@openwizard/core'
import {
  type DedupeApplication,
  type DedupeCompletion,
  DurableStoreError,
  type LeaseOptions,
  type RenewLeaseResult,
  type TimerCompletion,
  type Version,
} from '@openwizard/durable/store'
import type { DurableResumeOptions, DurableRunOpenResult, DurableRunOptions } from './durable-run'
import { createCoreRun, persistInitialSnapshot, resumeCoreRun } from './durable-run-core'
import { storedCommandResult } from './durable-run-dedupe'
import { makeHost } from './durable-run-host'
import type {
  BarrierInput,
  CommitFailureCode,
  DurableLeaseLossCode,
  PendingCommand,
} from './durable-run-state'
import {
  commitFailureCode,
  dedupeFailureCode,
  hostFailure,
  nativeScheduler,
  positive,
  sameVersion,
} from './durable-run-values'

type DurableOpenRequest<F extends AnyWizard> =
  | { readonly kind: 'create'; readonly options: DurableRunOptions<F> }
  | { readonly kind: 'resume'; readonly options: DurableResumeOptions<F> }

/** The renewal interval, or `undefined` for `'manual'`. It must leave the lease time to renew. */
function renewalInterval(renew: DurableRunOptions<AnyWizard>['renew'], ttlMs: number) {
  if (renew === 'manual') return undefined
  const everyMs = positive(renew?.everyMs ?? Math.max(1, Math.floor(ttlMs / 3)), 'renew.everyMs')
  if (everyMs >= ttlMs) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      `renew.everyMs (${everyMs}) must be less than the lease TTL (${ttlMs}), or the lease lapses between renewals`,
    )
  }
  return everyMs
}

export async function openDurableRun<F extends AnyWizard>(
  flow: F,
  request: DurableOpenRequest<F>,
): Promise<DurableRunOpenResult<F>> {
  const { options } = request
  const ttlMs = positive(options.lease?.ttlMs ?? options.store.leaseTtlMs, 'lease.ttlMs')
  const renewEveryMs = renewalInterval(options.renew, ttlMs)
  const stored = (snapshot: BarrierInput<F>['snapshot']): unknown =>
    options.redact === undefined ? snapshot : options.redact(snapshot)
  const acquired = await options.store.acquire(options.key, options.ownerId, { ttlMs })
  if (!acquired.ok) return acquired

  let currentLease = acquired.lease
  let persistedVersion = acquired.record?.version ?? null
  let publicVersion = acquired.record?.version ?? { epoch: 0, seq: 0 }
  let stopped = false
  let run: Run<F> | undefined
  let renewalHandle: unknown
  let pendingTimerClaims: TimerCompletion[] = []
  /** The external dispatch currently in flight; its source identity ties it to exact batches. */
  let pendingCommand: PendingCommand<F> | undefined
  let barrierTail = Promise.resolve()
  const startupBarriers: Promise<void>[] = []

  const enqueueBarrier = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const next = barrierTail.then(work, work)
    barrierTail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const scheduler = options.scheduler ?? nativeScheduler
  const stop = (): void => {
    if (stopped) return
    stopped = true
    pendingTimerClaims = []
    if (renewalHandle !== undefined) scheduler.clearTimeout(renewalHandle)
    renewalHandle = undefined
    run?.dispose()
  }
  const markLost = (code: DurableLeaseLossCode): void => {
    if (stopped) return
    stop()
    try {
      options.onLeaseLost?.(code)
    } catch {
      // A lease-loss observer cannot keep a stopped run alive.
    }
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
    if (stopped || renewEveryMs === undefined) return
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

  /** Remove and return the claims of every timer this batch fired. */
  const takeTimerClaims = (input: BarrierInput<F>): TimerCompletion[] => {
    const fired = new Set<string>()
    for (const event of input.events) {
      if (event.type === 'timer.fired' && 'timerId' in event) fired.add(event.timerId)
    }
    const taken = pendingTimerClaims.filter((claim) => fired.has(claim.timerId))
    pendingTimerClaims = pendingTimerClaims.filter((claim) => !fired.has(claim.timerId))
    return taken
  }

  const beforeTimer = async (timer: {
    readonly timerId: string
    readonly dueAt: number
    readonly expected: Version
  }): Promise<boolean> => {
    if (stopped) return false
    try {
      const claimed = await options.store.claimTimer({ lease: currentLease, ...timer })
      if (claimed.ok) {
        rememberTimerClaim({ ...timer, claimId: claimed.claimId })
        return true
      }
      if (claimed.code === 'LEASE_LOST') markLost('LEASE_LOST')
      // This owner already holds the claim (a re-armed timer after a retry): fire it.
      if (claimed.code === 'TIMER_ALREADY_CLAIMED' && claimed.ownerFence === currentLease.fence) {
        rememberTimerClaim({ ...timer, claimId: claimed.claimId })
        return true
      }
      return false
    } catch {
      markLost('LEASE_LOST')
      return false
    }
  }

  const persistSnapshot = async (
    input: BarrierInput<F>,
    applyDedupe: DedupeApplication | undefined,
    completeDedupe: DedupeCompletion | undefined,
    command: PendingCommand<F> | undefined,
  ): Promise<void> => {
    if (stopped) return
    const nextVersion: Version = { epoch: input.snapshot.epoch, seq: input.snapshot.seq }
    const completeTimers = takeTimerClaims(input)
    try {
      const committed = await options.store.commit({
        lease: currentLease,
        expected: persistedVersion,
        next: { value: stored(input.snapshot), version: nextVersion },
        ...(applyDedupe === undefined ? {} : { applyDedupe }),
        ...(completeDedupe === undefined ? {} : { completeDedupe }),
        ...(completeTimers.length === 0 ? {} : { completeTimers }),
      })
      if (!committed.ok) {
        if (command !== undefined && (applyDedupe !== undefined || completeDedupe !== undefined)) {
          command.failure = hostFailure(
            dedupeFailureCode(committed.code),
            committed.code === 'CAS_CONFLICT' ? { actual: committed.actual } : {},
          )
        }
        markLost(commitFailureCode(committed.code))
        return
      }
      persistedVersion = nextVersion
      publicVersion = nextVersion
      if (completeDedupe !== undefined && command !== undefined) {
        command.completedVersion = nextVersion
      }
    } catch {
      markLost('LEASE_LOST')
    }
  }

  const beforeEffects = (input: BarrierInput<F>): Promise<void> => {
    const command = pendingCommand
    const association = input.commands?.find((entry) => entry.command === command?.command)
    const matched = command !== undefined && association !== undefined
    const applyDedupe = matched && association.result === undefined ? command : undefined
    const completeDedupe =
      matched && association.result !== undefined
        ? {
            id: command.id,
            digest: command.digest,
            claimId: command.claimId,
            result: storedCommandResult(association.result, {
              epoch: input.snapshot.epoch,
              seq: input.snapshot.seq,
            }),
          }
        : undefined
    const next = enqueueBarrier(() => persistSnapshot(input, applyDedupe, completeDedupe, command))
    if (run === undefined) startupBarriers.push(next)
    return next
  }

  try {
    if (acquired.record === null) {
      if (request.kind === 'resume') {
        await options.store.release(currentLease)
        return { ok: false, code: 'RUN_NOT_FOUND' }
      }
      run = createCoreRun(flow, request.options, beforeEffects, beforeTimer)
    } else if (request.kind === 'create') {
      run = resumeCoreRun(flow, request.options, acquired.record.value, beforeEffects, beforeTimer)
    } else {
      run = resumeCoreRun(flow, request.options, acquired.record.value, beforeEffects, beforeTimer)
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
      const snapshot = run.getSnapshot()
      initial = await persistInitialSnapshot(
        options.store,
        currentLease,
        snapshot,
        stored(snapshot),
      )
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
    // A resumed batch may schedule synchronous follow-up work behind additional barriers.
    // Finish that drain before exposing the handle, so overdue deadlines win over late input.
    if (!stopped) {
      try {
        await run.whenIdle()
      } catch {
        markLost('LEASE_LOST')
      }
    }
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
    enqueueBarrier,
    trackCommand: (command) => {
      pendingCommand = command
    },
    store: options.store,
    renewLease,
    markLost,
    stop,
    isStopped: () => stopped,
  })
  scheduleRenewal()
  return { ok: true, host }
}
