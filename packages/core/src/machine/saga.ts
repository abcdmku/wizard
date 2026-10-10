/**
 * Saga — compensation (§5.2 / plan §8.5).
 *
 * Phase 1 (settle): `flow.compensating` (apply records `saga.settling` = tasks
 * whose `run` is in flight), every active step is cancelled (the interpreter
 * aborts runs on `step.cancelled`), then we wait for the settling results —
 * bounded by a persisted grace timer (`compensationGraceMs`, default 30 s):
 * when it fires, the still-unsettled attempts are marked orphaned.
 * Phase 2 (unwind): one `step.compensationStarted{step, runId}` at a time, in
 * reverse completion order over the stack entries (one per completion —
 * repeated activations are compensated separately), best-effort; failures
 * collect in `saga.failures`; `flow.compensated{outcome}` when nothing is left.
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec } from './batch'
import { cancelAllActive } from './scheduler'
import { sameEntry } from './selectors'
import type { SagaEntry, SagaEntryRef, SerializedError } from './state'

export const GRACE_TIMER_ID = 'saga:grace'
export const DEFAULT_COMPENSATION_GRACE_MS = 30_000

export function compensationGraceMs(b: Batch): number {
  return b.env.def.policies.compensationGraceMs ?? DEFAULT_COMPENSATION_GRACE_MS
}

function isSettled(b: Batch, ref: SagaEntryRef): boolean {
  const { compensated, failures } = b.state.saga
  return compensated.some((c) => sameEntry(c, ref)) || failures.some((f) => sameEntry(f, ref))
}

/** Stack entries still to compensate, in unwind order (highest seq first). */
export function pendingEntries(b: Batch): readonly SagaEntry[] {
  return [...b.state.saga.stack].reverse().filter((e) => !isSettled(b, e))
}

/**
 * Begin compensation. `plan` = step ids to (re)compensate; for the initial
 * trigger that is every pending stack entry, for `compensate({from})` re-runs
 * it is the subset of `saga.failures` to retry (apply drops them from `failures`).
 */
export function startCompensation(
  b: Batch,
  reason: string | undefined,
  outcome: 'failed' | 'cancelled',
  plan?: readonly string[],
): void {
  const list = plan ?? pendingEntries(b).map((e) => e.step)
  emit(b, {
    type: 'flow.compensating',
    plan: list,
    outcome,
    ...(reason !== undefined ? { reason } : {}),
  })
  cancelAllActive(b, reason ?? 'compensating')
  if ((b.state.saga.settling?.length ?? 0) > 0 && !(GRACE_TIMER_ID in b.state.timers)) {
    emit(b, {
      type: 'timer.scheduled',
      timerId: GRACE_TIMER_ID,
      dueAt: b.env.now() + compensationGraceMs(b),
      purpose: 'compensationGrace',
    })
  }
  unwindNext(b)
}

/** True while an in-flight compensate call (or settling run) blocks the next unwind step. */
function unwindBlocked(b: Batch): boolean {
  if ((b.state.saga.settling?.length ?? 0) > 0) return true
  return b.state.saga.inFlight !== undefined
}

/** Phase 2 driver: called after every event that may unblock the unwind. */
export function unwindNext(b: Batch): void {
  if (b.state.status !== 'compensating') return
  if (unwindBlocked(b)) return
  if (GRACE_TIMER_ID in b.state.timers) emit(b, { type: 'timer.cleared', timerId: GRACE_TIMER_ID })
  const entry = pendingEntries(b)[0]
  if (entry === undefined) {
    emit(b, {
      type: 'flow.compensated',
      failures: b.state.saga.failures.map((f) => f.step),
      outcome: b.state.saga.outcome ?? 'failed',
    })
    return
  }
  emit(b, { type: 'step.compensationStarted', step: entry.step, runId: entry.runId })
}

export function onCompensated(b: Batch, ref: SagaEntryRef): void {
  emit(b, { type: 'step.compensated', step: ref.step, runId: ref.runId })
  unwindNext(b)
}

export function onCompensationFailed(b: Batch, ref: SagaEntryRef, error: SerializedError): void {
  emit(b, { type: 'step.compensationFailed', step: ref.step, runId: ref.runId, error })
  unwindNext(b)
}

/**
 * End phase 1 for attempts that can no longer report (grace expired, or the
 * process restarted): record an abandoned attempt per settling step, then unwind.
 */
export function orphanSettling(b: Batch, code: 'ORPHANED' | 'INTERRUPTED'): void {
  for (const step of [...(b.state.saga.settling ?? [])]) {
    const r = rec(b, step)
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r?.attempt ?? 0,
      error: {
        name: code === 'ORPHANED' ? 'OrphanedError' : 'InterruptedError',
        message:
          code === 'ORPHANED'
            ? 'aborted run did not settle within the compensation grace period'
            : 'aborted run was interrupted by a restart',
        code,
      },
      willRetry: false,
    })
  }
  unwindNext(b)
}
