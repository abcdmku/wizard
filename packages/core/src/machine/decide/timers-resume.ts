/**
 * Timers (`timer.fired`: retry, wait timeout, inbox TTL, compensation grace) and the resume
 * matrix (plan §8.8 / §10.4).
 * @internal
 */

import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import { onNavIdle, rejectNav } from '../nav'
import { orphanSettling, unwindNext } from '../saga'
import { currentIdempotencyKey, failStep, hasOnHandlers, schedule } from '../scheduler'
import { isTerminal, runInFlight } from '../selectors'
import { drainInbox, expireEntry, expireInbox, onWaitTimeout } from '../wait'

export function onTimerFired(b: Batch, timerId: string): void {
  const entry = b.state.timers[timerId]
  if (entry === undefined) return
  emit(b, { type: 'timer.fired', timerId })
  const owner = entry.step !== undefined ? rec(b, entry.step) : undefined
  switch (entry.purpose) {
    case 'retry': {
      if (owner === undefined || entry.step === undefined) return
      if (owner.status !== 'active' || owner.kind !== 'task') return
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
 * Resume matrix (plan §8.8 / §10.4). `plan(flow.resumed)` re-arms timers and re-issues
 * in-flight hook calls. An interrupted run is re-issued when the task is idempotent
 * (`step.runStarted { resumed: true }`, same attempt/key), else it fails `interrupted`.
 */
export function onResume(b: Batch, fromSeq: number): void {
  const s = b.state
  const interrupted = s.active.filter((id) => runInFlight(s.steps[id]))
  emit(b, { type: 'flow.resumed', fromSeq, interrupted })
  if (s.nav.phase !== 'idle')
    rejectNav(b, 'resumed', { txId: s.nav.txId ?? b.env.id('tx'), deferIdle: true })
  for (const step of interrupted) {
    const r = rec(b, step)
    if (r !== undefined && stepDef(b, step)?.idempotent === true) {
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
    if (r?.kind !== 'view' && r?.status === 'active' && r.entering !== true && hasOnHandlers(b, id))
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
