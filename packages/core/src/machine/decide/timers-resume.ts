/**
 * Timers (`timer.fired`: retry, wait timeout, inbox TTL, compensation grace) and the resume
 * matrix.
 * @internal
 */

import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import { onEachTimer, resumeEach } from '../each'
import { onNavIdle, rejectNav } from '../nav'
import { resumeAutoNavigation } from '../nav-resume'
import { orphanSettling, unwindNext } from '../saga'
import { currentIdempotencyKey, failStep, hasEventHandlers, schedule } from '../scheduler'
import { isRunnableStep, isTerminal, runInFlight } from '../selectors'
import { onSleepTimer } from '../sleep'
import { drainInbox, expireEntry, expireInbox, onWaitTimeout } from '../wait'

export function onTimerFired(b: Batch, timerId: string): void {
  if (onEachTimer(b, timerId)) return
  const entry = b.state.timers[timerId]
  if (entry === undefined) return
  emit(b, { type: 'timer.fired', timerId })
  const owner = entry.step !== undefined ? rec(b, entry.step) : undefined
  switch (entry.purpose) {
    case 'retry': {
      if (owner === undefined || entry.step === undefined) return
      if (owner.status !== 'active' || !isRunnableStep(stepDef(b, entry.step))) return
      emit(b, {
        type: 'step.runStarted',
        step: entry.step,
        attempt: owner.attempt + 1,
        runId: owner.runId,
        idempotencyKey: currentIdempotencyKey(b, entry.step, owner.runId),
      })
      return
    }
    case 'waitTimeout': {
      if (owner === undefined || entry.step === undefined) return
      if (owner.status !== 'active' || owner.entering === true) return
      onWaitTimeout(b, entry.step)
      return
    }
    case 'sleep':
      if (entry.step !== undefined) onSleepTimer(b, entry.step)
      return
    case 'inboxTtl': {
      const inbox = b.state.inbox.find((e) => `inbox:${e.id}` === timerId)
      if (inbox !== undefined) expireEntry(b, inbox.id)
      return
    }
    case 'compensationGrace':
      if (b.state.status === 'compensating') orphanSettling(b, 'ORPHANED')
      return
    default:
      return
  }
}

/**
 * Deadlines are absolute: wait timeouts and retries that are already due fire now, in due
 * order — on resume, and before an event is delivered (a late event never beats its timeout).
 */
export function fireOverdue(b: Batch): void {
  const now = b.env.now()
  const due = Object.entries(b.state.timers)
    .filter(
      ([, t]) =>
        (t.purpose === 'waitTimeout' || t.purpose === 'retry' || t.purpose === 'sleep') &&
        t.at <= now,
    )
    .sort((x, y) => x[1].at - y[1].at)
  for (const [timerId] of due) onTimerFired(b, timerId)
}

/**
 * Resume matrix. `plan(run.resumed)` re-arms timers and re-issues
 * in-flight hook calls. Overdue timers fire first; then each run interrupted by the restart
 * that is still the same run is re-issued when the step is idempotent (`step.runStarted
 * { resumed: true }`, same attempt/key), else it fails `interrupted`. The ordering covers one
 * run's own work: a parent resumes before its children are restored, and runs in a tree are not
 * ordered against each other.
 */
export function onResume(b: Batch, fromSeq: number): void {
  const s = b.state
  const maps = b.env.def.order.flatMap((step) => {
    const record = s.steps[step]
    const each = record?.each
    return stepDef(b, step)?.each !== undefined &&
      each !== undefined &&
      (record?.status === 'active' || record?.status === 'failed')
      ? [{ step, each }]
      : []
  })
  const runs = s.active.flatMap((step) => {
    const r = s.steps[step]
    return r !== undefined && stepDef(b, step)?.each === undefined && runInFlight(r)
      ? [{ step, runId: r.runId, attempt: r.attempt }]
      : []
  })
  emit(b, { type: 'run.resumed', fromSeq, interrupted: runs.map((run) => run.step) })
  if (s.nav.phase !== 'idle')
    rejectNav(b, 'resumed', { txId: s.nav.txId ?? b.env.id('tx'), deferIdle: true })
  fireOverdue(b)
  resumeAutoNavigation(b, s.nav)
  for (const { step, each } of maps) resumeEach(b, step, each)
  for (const { step, runId, attempt } of runs) {
    const r = rec(b, step)
    if (!runInFlight(r) || r?.runId !== runId || r.attempt !== attempt) continue
    if (stepDef(b, step)?.idempotent === true) {
      emit(b, {
        type: 'step.runStarted',
        step,
        attempt: r.attempt,
        runId: r.runId,
        idempotencyKey: currentIdempotencyKey(b, step, r.runId),
        resumed: true,
      })
      continue
    }
    failStep(
      b,
      step,
      { name: 'InterruptedError', message: 'run interrupted by a restart', code: 'INTERRUPTED' },
      'interrupted',
    )
  }
  expireInbox(b)
  for (const id of [...b.state.active]) {
    const r = rec(b, id)
    if (
      r?.kind !== 'view' &&
      r?.status === 'active' &&
      r.entering !== true &&
      hasEventHandlers(b, id)
    )
      drainInbox(b, id)
  }
  if (b.state.status === 'compensating') {
    // Aborted runs can never report after a restart: settle them as interrupted, then continue.
    if ((b.state.saga.settling?.length ?? 0) > 0) orphanSettling(b, 'INTERRUPTED')
    else unwindNext(b)
  } else if (!isTerminal(b.state)) {
    onNavIdle(b)
    schedule(b)
  }
}
