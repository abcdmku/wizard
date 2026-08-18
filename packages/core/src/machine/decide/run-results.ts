/**
 * Task run results (§4.1 / §10.7): success, failure with retry / backoff, `mapError`, and the
 * settling of aborted runs during compensation phase 1.
 * @internal
 */

import type { RetryPolicy } from '../../authoring/compiled'
import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import { completeStep } from '../nav'
import { unwindNext } from '../saga'
import { failStep, retryTimerId } from '../scheduler'
import { runInFlight } from '../selectors'
import type { SerializedError } from '../state'
import type { ResultMsg } from './results'

/** `RetryPolicy` backoff (§4.1): fixed ms, or exponential `min(baseMs * factor^(attempt-1), maxBackoffMs)`. */
function backoffMs(policy: RetryPolicy | undefined, attempt: number): number {
  const backoff = policy?.backoff
  if (backoff === undefined) return 0
  if (typeof backoff === 'number') return backoff
  const base = policy?.baseMs ?? 200
  const factor = policy?.factor ?? 2
  return Math.min(base * factor ** (attempt - 1), policy?.maxBackoffMs ?? 30_000)
}

export function onRunResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined || def.kind !== 'task') return false
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
  }
  if (def.hooks.mapError !== undefined) {
    // v0.2 (§10.7): map the failure first; `onMapErrorResult` records it with `data`.
    emit(b, {
      type: 'step.mapErrorStarted',
      step,
      attempt: r.attempt,
      error: msg.error,
      ...(failure.timedOut ? { timedOut: true } : {}),
      ...(failure.syncViolation ? { syncViolation: true } : {}),
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
}

/** `res.*(mapError)`: the failure it was mapping is echoed in `extra`; a throwing mapper yields no `data`. */
export function onMapErrorResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined || def.kind !== 'task' || !runInFlight(r)) return false
  const extra = msg.extra ?? {}
  const error = isSerializedError(extra.error)
    ? extra.error
    : { name: 'Error', message: 'unknown failure' }
  const failure: RunFailure = {
    error,
    timedOut: extra.timedOut === true,
    syncViolation: extra.syncViolation === true,
  }
  recordRunFailure(b, step, failure, msg.type === 'res.ok' ? msg.value : undefined)
  return true
}

function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

/** `step.runFailed { data? }` then retry (`step.retryScheduled`) or fail for good (§4.1). */
function recordRunFailure(b: Batch, step: string, failure: RunFailure, data: unknown): void {
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined) return
  const dataField = data !== undefined ? { data } : {}
  const timedOutField = failure.timedOut ? { timedOut: true } : {}
  if (failure.syncViolation) {
    // `strict: 'sync'` violation: never retried, fails as 'sync-violation' (plan §8.1).
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r.attempt,
      error: failure.error,
      willRetry: false,
      ...dataField,
    })
    failStep(b, step, failure.error, 'sync-violation', data)
    return
  }
  const policy = def.retry ?? b.env.def.policies.retry
  const allowed = policy?.attempts ?? 0
  if (r.attempt <= allowed) {
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r.attempt,
      error: failure.error,
      willRetry: true,
      ...timedOutField,
      ...dataField,
    })
    const timerId = retryTimerId(step)
    emit(b, {
      type: 'step.retryScheduled',
      step,
      attempt: r.attempt + 1,
      dueAt: b.env.now() + backoffMs(policy, r.attempt),
      timerId,
    })
    return
  }
  emit(b, {
    type: 'step.runFailed',
    step,
    attempt: r.attempt,
    error: failure.error,
    willRetry: false,
    ...timedOutField,
    ...dataField,
  })
  failStep(b, step, failure.error, failure.timedOut ? 'timeout' : 'run', data)
}
