/**
 * `plan` — events → effect descriptions. Receives the POST-batch state and the
 * whole batch, so every rule first checks that the state is still
 * "parked" where the event says (a transaction still in that phase, a step
 * still active with the same runId/attempt, a timer still registered): a batch
 * that moved past a phase synchronously produces no effect for it.
 *
 * One `persist` effect is appended per batch that changed state.
 *
 * @internal
 */

import { eachChildAddress } from './child-address'
import { planEachEvent } from './each-plan'
import type { Effect } from './effects'
import type { DomainEvent } from './events'
import { call } from './plan-call'
import { planCompensate, planKindStart, planResume } from './plan-lifecycle'
import { planPhase } from './plan-phase'
import type { WizardState } from './state'
import { stepIndex } from './step-index'
import type { MachineEnv } from './types'

export function plan(
  env: MachineEnv,
  state: WizardState,
  events: readonly DomainEvent[],
): readonly Effect[] {
  const out: Effect[] = []
  // Resume effects (re-issued calls, then re-armed timers) go AFTER everything else in the batch;
  // overdue timers already fired inside the resume batch, only future ones are re-armed.
  const resume: Effect[] = []
  let final = false
  let resumed = false
  let delivery: Delivery | undefined
  for (const ev of events) {
    if (ev.type === 'event.received')
      delivery = { inboxId: ev.inboxId, failed: stepIndex(state.steps).failed }
    if (ev.type === 'run.resumed') resumed = true
    else planEvent(env, state, ev, out, delivery)
    if (ev.type === 'run.done' || ev.type === 'run.cancelled' || ev.type === 'run.compensated')
      final = true
  }
  if (resumed) {
    // Steps whose entry/compensation started in this very batch already got their calls above.
    const fresh = new Set<string>()
    for (const ev of events) {
      if (
        ev.type === 'step.entered' ||
        ev.type === 'step.enterCompleted' ||
        ev.type === 'step.compensationStarted' ||
        ev.type === 'step.whenStarted' ||
        ev.type === 'step.idempotencyKeyRequested'
      ) {
        fresh.add(ev.step)
      } else if (ev.type === 'transition.phase' && ev.phase === 'entering') {
        for (const step of state.nav.pendingSteps ?? []) fresh.add(step)
      }
    }
    planResume(env, state, resume, fresh)
  }
  out.push(...resume)
  // Every non-empty batch advances `seq`/`updatedAt` → persist (rejections and ignored results included).
  if (events.length > 0) out.push({ kind: 'persist', reason: final ? 'final' : 'change' })
  return out
}

/** The event a `send` received in this batch and the failed-step count once it was decided. */
interface Delivery {
  readonly inboxId: string
  readonly failed: number
}

/** Handler calls for the event the batch's `send` received carry its baseline (R6). */
function deliveryToken(
  delivery: Delivery | undefined,
  inboxId: string,
): { readonly failedAtDelivery?: number } {
  return delivery?.inboxId === inboxId ? { failedAtDelivery: delivery.failed } : {}
}

function planEvent(
  env: MachineEnv,
  state: WizardState,
  ev: DomainEvent,
  out: Effect[],
  delivery: Delivery | undefined,
): void {
  if (planEachEvent(env, state, ev, out)) return
  switch (ev.type) {
    case 'transition.phase':
      planPhase(env, state, ev, out)
      return
    case 'transition.committed':
      out.push({
        kind: 'settle',
        txId: ev.txId,
        outcome: 'ok',
        value: { from: ev.from, to: ev.to },
      })
      return
    case 'transition.rejected':
      out.push({
        kind: 'settle',
        txId: ev.txId,
        outcome: 'rejected',
        error: {
          reason: ev.reason,
          ...(ev.step !== undefined ? { step: ev.step } : {}),
          ...(ev.issues !== undefined ? { issues: ev.issues } : {}),
        },
      })
      return
    case 'transition.failed':
      out.push({ kind: 'settle', txId: ev.txId, outcome: 'failed', error: ev.error })
      return
    case 'step.entered': {
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.runId !== ev.runId) return
      if (rec.initializing !== undefined) {
        if (rec.initializing === ev.seq)
          out.push(call(env, rec, 'initial', { initialSeq: rec.initializing }))
      } else if (rec.entering === true) {
        out.push(call(env, rec, 'enter', { extra: { from: ev.from } }))
      } else planKindStart(env, rec, out)
      return
    }
    case 'step.enterCompleted': {
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.entering === true) return
      planKindStart(env, rec, out)
      return
    }
    case 'input.changed': {
      const rec = state.steps[ev.step]
      const def = env.def.steps[ev.step]
      if (rec === undefined || def === undefined) return
      if (ev.reset === true && rec.initializing === ev.seq) {
        out.push(call(env, rec, 'initial', { initialSeq: rec.initializing }))
      } else if (
        ev.reset === false &&
        state.nav.phase === 'idle' &&
        rec.entering === true &&
        def.hooks.enter !== undefined
      ) {
        out.push(call(env, rec, 'enter', { extra: { from: null } }))
      }
      return
    }
    case 'step.whenStarted': {
      // The predicate runs while the step is still pending (token = current runId).
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status === 'active' || rec.when !== 'pending') return
      out.push(call(env, rec, 'when'))
      return
    }
    case 'step.idempotencyKeyRequested': {
      // Computed before the first attempt of the run (args = the run's args).
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.runId !== ev.runId) return
      if (rec.attempt !== 0 || rec.entering === true) return
      out.push(call(env, rec, 'idempotencyKey', { extra: { attempt: 1 } }))
      return
    }
    case 'step.mapErrorStarted': {
      // The raw failure travels in `extra` and comes back on the result.
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.attempt !== ev.attempt) return
      if (rec.retryAt !== undefined || rec.entering === true) return
      out.push(
        call(env, rec, 'mapError', {
          attempt: ev.attempt,
          extra: {
            error: ev.error,
            attempt: ev.attempt,
            ...(ev.timedOut === true ? { timedOut: true } : {}),
            ...(ev.syncViolation === true ? { syncViolation: true } : {}),
            ...(ev.failureKind !== undefined ? { failureKind: ev.failureKind } : {}),
          },
        }),
      )
      return
    }
    case 'step.runStarted': {
      const rec = state.steps[ev.step]
      if (
        rec === undefined ||
        rec.status !== 'active' ||
        rec.runId !== ev.runId ||
        rec.attempt !== ev.attempt
      )
        return
      if (rec.retryAt !== undefined || rec.entering === true) return
      const timeoutMs = env.def.steps[ev.step]?.timeoutMs
      out.push(
        call(env, rec, 'run', {
          attempt: ev.attempt,
          extra: { attempt: ev.attempt },
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      )
      return
    }
    case 'step.retryScheduled':
    case 'timer.scheduled': {
      const entry = state.timers[ev.timerId]
      if (entry !== undefined)
        out.push({ kind: 'timer.set', timerId: ev.timerId, at: entry.at, fire: entry.fire })
      return
    }
    case 'timer.cleared':
      out.push({ kind: 'timer.clear', timerId: ev.timerId })
      return
    case 'event.delivered': {
      const rec = state.steps[ev.to]
      if (rec === undefined || rec.status !== 'active' || rec.entering === true) return
      const hooks = env.def.steps[ev.to]?.hooks
      if (typeof (hooks?.waitFor?.[ev.event] ?? hooks?.on?.[ev.event]) !== 'function') return
      out.push(
        call(env, rec, 'on', {
          extra: { event: ev.event, payload: ev.payload, inboxId: ev.inboxId },
          ...deliveryToken(delivery, ev.inboxId),
        }),
      )
      return
    }
    case 'event.wizardDelivered':
      // The wizard-level handler has no step — `step: ''`, token `{ step: '', runId: 0 }`;
      // the executor and `decide` route on `hook: 'wizardOn'` before looking at the step.
      out.push({
        kind: 'call',
        effectId: env.id('fx'),
        step: '',
        hook: 'wizardOn',
        token: { step: '', runId: 0, ...deliveryToken(delivery, ev.inboxId) },
        extra: { event: ev.event, payload: ev.payload, inboxId: ev.inboxId },
      })
      return
    case 'step.compensationStarted': {
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'compensating') return
      planCompensate(env, state, rec, out)
      return
    }
    case 'step.cancelled': {
      const rec = state.steps[ev.step]
      if (rec?.kind === 'child') {
        out.push({
          kind: 'child.send',
          step: ev.step,
          command: { type: 'cancel', ...(ev.reason !== undefined ? { reason: ev.reason } : {}) },
        })
      }
      return
    }
    case 'step.skipped':
      if (ev.reason === 'fallback' && state.steps[ev.step]?.kind === 'child')
        out.push({ kind: 'child.dispose', step: ev.step })
      return
    case 'step.invalidated':
      if (env.def.steps[ev.step]?.kind === 'child')
        out.push({ kind: 'child.dispose', step: ev.step })
      return
    case 'child.started':
      out.push({ kind: 'child.create', step: ev.step, context: ev.context })
      return
    case 'child.summary': {
      const rec = state.steps[ev.step]
      if (ev.done === undefined || rec === undefined || rec.status !== 'active') return
      if (env.def.steps[ev.step]?.hooks.childOutput === undefined) return
      out.push(call(env, rec, 'childOutput', { extra: { output: ev.done.output } }))
      return
    }
    case 'child.command': {
      const key =
        ev.itemIndex === undefined ? undefined : state.steps[ev.step]?.each?.keys[ev.itemIndex]
      if (ev.itemIndex !== undefined && key === undefined) return
      const step =
        ev.itemIndex === undefined || key === undefined
          ? ev.step
          : eachChildAddress(ev.step, ev.itemIndex, key, env.def.steps)
      out.push({ kind: 'child.send', step, command: ev.command })
      return
    }
    case 'run.reset':
      for (const id of env.def.order)
        if (env.def.steps[id]?.kind === 'child') out.push({ kind: 'child.dispose', step: id })
      return
    default:
      return
  }
}
