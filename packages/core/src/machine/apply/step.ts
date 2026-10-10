/**
 * Reducers for the step-lifecycle events (`step.arrived` … `step.guardEvaluated`).
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import type { DomainEvent } from '../events'
import { isTerminal } from '../selectors'
import type { WizardState } from '../state'
import type { MachineEnv } from '../types'
import { omit } from '../util'
import { patchStep, toStepError, withNav, withSaga, withStep } from './patch'

/** Forget the cursor hint when it points at `step` (the view entered, was skipped, invalidated, …). */
function dropHint(state: WizardState, step: string): WizardState {
  if (state.nav.cursorHint !== step) return state
  return withNav(state, omit(state.nav, ['cursorHint']))
}

/** Drop `step`'s queued auto-advance continuation (`nav.deferred`), if any. */
function withoutDeferred(state: WizardState, step: string): WizardState {
  const deferred = state.nav.deferred
  if (deferred === undefined || !deferred.some((d) => d.step === step)) return state
  const rest = deferred.filter((d) => d.step !== step)
  return withNav(state, {
    ...omit(state.nav, ['deferred']),
    ...(rest.length > 0 ? { deferred: rest } : {}),
  })
}

/**
 * v0.2: a non-view step that completed (`step.done`) or was skipped while a transition was in
 * flight continues (auto-advance) once `nav` is idle again: queue it in `nav.deferred`.
 */
function deferContinuation(
  def: CompiledFlow,
  state: WizardState,
  step: string,
  override: string | undefined,
): WizardState {
  const stepDef = def.steps[step]
  const busy = state.nav.phase !== 'idle' && state.status !== 'compensating' && !isTerminal(state)
  const advances =
    stepDef !== undefined &&
    stepDef.kind !== 'final' &&
    (override !== undefined || stepDef.next.kind !== 'none')
  if (!busy || !advances) return state
  const entry = override !== undefined ? { step, to: override } : { step }
  return withNav(state, { ...state.nav, deferred: [...(state.nav.deferred ?? []), entry] })
}

export function applyStep(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'step.arrived':
      return withStep(state, ev.step, (rec) => {
        if (rec.status === 'active' || rec.pendingActivation) return rec
        return { ...rec, pendingActivation: true, arrivedSeq: ev.seq }
      })
    case 'step.entered':
      // A step that enters again forgets a continuation queued for its previous completion.
      return withStep(withoutDeferred(dropHint(state, ev.step), ev.step), ev.step, (rec) => {
        const def = env.def.steps[ev.step]
        const seedInput =
          rec.kind === 'view' && rec.input === undefined && def?.initial !== undefined
            ? { input: def.initial }
            : {}
        const base = omit(rec, [
          'error',
          'issues',
          'output',
          'retryAt',
          'deadline',
          'idempotencyKey',
          'arrivedSeq',
          'exitedAt',
          'child',
          'entering',
          'enterDone',
          'when',
          'skipReason',
        ])
        return {
          ...base,
          ...seedInput,
          status: 'active',
          runId: ev.runId,
          attempt: 0,
          pendingActivation: false,
          enteredAt: ev.at,
          visitedCount: rec.visitedCount + 1,
          ...(ev.enterPending === true ? { entering: true } : {}),
        }
      })
    case 'step.enterCompleted': {
      // Transition `entering` phase: the target's hook resolved before commit → mark it so the
      // commit's `step.entered` skips the hook; scheduler entry: just leave the sub-phase.
      const inPhase =
        state.nav.phase === 'entering' && (state.nav.pendingSteps ?? []).includes(ev.step)
      let next = patchStep(state, ev.step, inPhase ? { enterDone: true } : {}, ['entering'])
      if (inPhase) {
        next = withNav(next, {
          ...next.nav,
          pendingSteps: (next.nav.pendingSteps ?? []).filter((s) => s !== ev.step),
        })
      }
      return next
    }
    case 'step.exited':
      return withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['entering']),
        status: ev.direction === 'back' ? 'idle' : 'done',
        pendingActivation: false,
        exitedAt: ev.at,
      }))
    case 'step.done': {
      const def = env.def.steps[ev.step]
      let next = withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['error', 'retryAt', 'deadline', 'entering', 'output']),
        status: 'done',
        pendingActivation: false,
        ...(ev.output !== undefined ? { output: ev.output } : {}),
      }))
      if (def?.hooks.compensate !== undefined) {
        const runId = state.steps[ev.step]?.runId ?? 0
        const entry = {
          step: ev.step,
          runId,
          seq: ev.seq,
          ...(ev.output !== undefined ? { output: ev.output } : {}),
        }
        next = withSaga(next, { ...next.saga, stack: [...state.saga.stack, entry] })
      }
      return def?.kind === 'view' ? next : deferContinuation(env.def, next, ev.step, ev.next)
    }
    case 'step.failed':
      return withStep(dropHint(state, ev.step), ev.step, (rec) => ({
        ...omit(rec, ['retryAt', 'deadline', 'entering', 'when']),
        status: 'failed',
        pendingActivation: false,
        error: toStepError(
          ev.error,
          ev.kind,
          ev.at,
          rec.attempt > 0 ? rec.attempt : undefined,
          ev.data,
        ),
      }))
    case 'step.skipped': {
      // v0.2 (§9.2): done-without-running — no output, no error; the draft `input` and
      // `previousOutput` survive. Continues (auto-advance) once `nav` is idle when busy.
      const next = withStep(dropHint(state, ev.step), ev.step, (rec) => ({
        ...omit(rec, [
          'entering',
          'when',
          'error',
          'issues',
          'output',
          'retryAt',
          'deadline',
          'idempotencyKey',
          'arrivedSeq',
        ]),
        status: 'skipped',
        pendingActivation: false,
        ...(ev.reason !== undefined ? { skipReason: ev.reason } : {}),
      }))
      return deferContinuation(env.def, next, ev.step, undefined)
    }
    case 'step.whenStarted':
      return patchStep(state, ev.step, { when: 'pending' })
    case 'step.whenEvaluated':
      return ev.ok
        ? patchStep(state, ev.step, { when: 'passed' })
        : patchStep(state, ev.step, {}, ['when'])
    case 'step.invalidated':
      // v0.2 (§9.3): back to idle; the output moves to `previousOutput`, a view keeps its draft.
      return withStep(dropHint(state, ev.step), ev.step, (rec) => ({
        ...omit(rec, [
          'output',
          'previousOutput',
          'error',
          'issues',
          'skipReason',
          'retryAt',
          'deadline',
          'idempotencyKey',
          'arrivedSeq',
          'entering',
          'enterDone',
          'when',
          'child',
        ]),
        status: 'idle',
        pendingActivation: false,
        ...(rec.output !== undefined ? { previousOutput: rec.output } : {}),
      }))
    case 'step.cancelled':
      return patchStep(state, ev.step, { status: 'cancelled', pendingActivation: false }, [
        'entering',
        'retryAt',
        'deadline',
        'when',
      ])
    case 'step.validated':
      return withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['issues']),
        ...(ev.output !== undefined ? { output: ev.output } : {}),
      }))
    case 'step.validationFailed':
      return patchStep(state, ev.step, { issues: ev.issues })
    case 'step.guardEvaluated': {
      const guard = {
        ok: ev.ok,
        seq: ev.seq,
        ...(ev.reason !== undefined ? { reason: ev.reason } : {}),
      }
      let next = withStep(state, ev.step, (rec) => ({
        ...rec,
        guards: { ...rec.guards, [ev.hook]: guard },
      }))
      if (
        ev.hook === 'canEnter' &&
        ev.ok &&
        state.nav.phase === 'canEnter' &&
        state.nav.pendingSteps?.includes(ev.step)
      ) {
        next = withNav(next, {
          ...next.nav,
          pendingSteps: next.nav.pendingSteps?.filter((s) => s !== ev.step) ?? [],
        })
      }
      return next
    }
    default:
      return state
  }
}
