/**
 * Task run results: success, failure with retry / backoff, `mapError`, and the
 * settling of aborted runs during compensation phase 1.
 * @internal
 */

import type { RetryPolicy } from '../../authoring/compiled'
import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import { completeStep } from '../nav'
import { unwindNext } from '../saga'
import { failStep, retryTimerId } from '../scheduler'
import { isRunnableStep, runInFlight } from '../selectors'
import type { SerializedError } from '../state'
import { isSerializedError } from '../util'
import type { ResultMsg } from './results'

/**
 * `RetryPolicy` backoff: fixed ms, or exponential `min(baseMs * factor^(attempt-1),
 * maxBackoffMs)`; `jitter` shortens it by a random share of up to `jitter`.
 */
export function backoffMs(b: Batch, policy: RetryPolicy | undefined, attempt: number): number {
  const backoff = policy?.backoff
  if (backoff === undefined) return 0
  const delay =
    typeof backoff === 'number'
      ? backoff
      : Math.min(
          (policy?.baseMs ?? 200) * (policy?.factor ?? 2) ** (attempt - 1),
          policy?.maxBackoffMs ?? 30_000,
        )
  const jitter = policy?.jitter ?? 0
  if (jitter === 0) return delay
  return Math.round(delay * (1 - jitter * (b.env.random ?? Math.random)()))
}

export function onRunResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || !isRunnableStep(def)) return false
  const settling = b.state.saga.settling?.includes(step) === true
  if (r.status === 'cancelled' && settling) {
    // Compensation phase 1: a late result of an aborted run still settles (and a late success is pushed on the stack).
    if (msg.type === 'res.ok') {
      emit(b, { type: 'step.runSucceeded', step, attempt: r.attempt, output: msg.value })
      emit(b, {
        type: 'step.done',
        step,
        ...(msg.value !== undefined ? { output: msg.value } : {}),
      })
    } else {
      emit(b, {
        type: 'step.runFailed',
        step,
        attempt: r.attempt,
        error: msg.error,
        willRetry: false,
        ...(msg.timedOut === true ? { timedOut: true } : {}),
      })
    }
    unwindNext(b)
    return true
  }
  if (!runInFlight(r)) return false
  if (msg.type === 'res.ok') {
    emit(b, { type: 'step.runSucceeded', step, attempt: r.attempt, output: msg.value })
    completeStep(b, step, msg.value)
    return true
  }
  const failure: RunFailure = {
    error: msg.error,
    timedOut: msg.timedOut === true,
    syncViolation: msg.syncViolation === true,
    retryable: msg.retryable !== false,
    failureKind: msg.failure?.kind,
    data: msg.failure?.data,
  }
  if (def.hooks.mapError !== undefined && msg.error.code !== 'INVALID_RUN_ERROR') {
    // Map the failure first; `onMapErrorResult` records it with `data`.
    emit(b, {
      type: 'step.mapErrorStarted',
      step,
      attempt: r.attempt,
      error: msg.error,
      ...(failure.timedOut ? { timedOut: true } : {}),
      ...(failure.syncViolation ? { syncViolation: true } : {}),
      ...(failure.failureKind !== undefined ? { failureKind: failure.failureKind } : {}),
    })
    return true
  }
  recordRunFailure(b, step, failure, undefined)
  return true
}

interface RunFailure {
  readonly error: SerializedError
  readonly timedOut: boolean
  readonly syncViolation: boolean
  /** False when the step's `retry.when` rejected this failure. */
  readonly retryable: boolean
  readonly failureKind: 'typed' | 'defect' | 'interrupted' | undefined
  readonly data: unknown
}

/** `res.*(mapError)`: the failure it was mapping is echoed in `extra`; a throwing mapper yields no `data`. */
export function onMapErrorResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || !isRunnableStep(def) || !runInFlight(r)) return false
  if (
    msg.type === 'res.err' &&
    (msg.error.code === 'INVALID_MAP_ERROR' || msg.syncViolation === true)
  ) {
    failStep(b, step, msg.error, msg.syncViolation === true ? 'sync-violation' : 'hook')
    return true
  }
  const extra = msg.extra ?? {}
  const error = isSerializedError(extra.error)
    ? extra.error
    : { name: 'Error', message: 'unknown failure' }
  const failure: RunFailure = {
    error,
    timedOut: extra.timedOut === true,
    syncViolation: extra.syncViolation === true,
    retryable: msg.retryable !== false,
    failureKind:
      extra.failureKind === 'typed' ||
      extra.failureKind === 'defect' ||
      extra.failureKind === 'interrupted'
        ? extra.failureKind
        : undefined,
    data: undefined,
  }
  recordRunFailure(b, step, failure, msg.type === 'res.ok' ? msg.value : undefined)
  return true
}

/** `step.runFailed { data? }` then retry (`step.retryScheduled`) or fail for good. */
function recordRunFailure(b: Batch, step: string, failure: RunFailure, data: unknown): void {
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined) return
  const effectiveData = data !== undefined ? data : failure.data
  const error =
    effectiveData === undefined ? failure.error : { ...failure.error, data: effectiveData }
  const dataField = effectiveData !== undefined ? { data: effectiveData } : {}
  const timedOutField = failure.timedOut ? { timedOut: true } : {}
  if (failure.syncViolation) {
    // `strict: 'sync'` violation: never retried, fails as 'sync-violation'.
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r.attempt,
      error,
      willRetry: false,
      ...dataField,
      ...(failure.failureKind !== undefined ? { failureKind: failure.failureKind } : {}),
    })
    failStep(b, step, error, 'sync-violation', effectiveData)
    return
  }
  const policy = def.retry ?? b.env.def.policies.retry
  const allowed = policy?.retries ?? 0
  if (r.attempt <= allowed && failure.retryable) {
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r.attempt,
      error,
      willRetry: true,
      ...timedOutField,
      ...dataField,
      ...(failure.failureKind !== undefined ? { failureKind: failure.failureKind } : {}),
    })
    const timerId = retryTimerId(step)
    emit(b, {
      type: 'step.retryScheduled',
      step,
      attempt: r.attempt + 1,
      dueAt: b.env.now() + backoffMs(b, policy, r.attempt),
      timerId,
    })
    return
  }
  emit(b, {
    type: 'step.runFailed',
    step,
    attempt: r.attempt,
    error,
    willRetry: false,
    ...timedOutField,
    ...dataField,
    ...(failure.failureKind !== undefined ? { failureKind: failure.failureKind } : {}),
  })
  failStep(
    b,
    step,
    error,
    failure.timedOut ? 'timeout' : (failure.failureKind ?? 'run'),
    effectiveData,
  )
}
