/**
 * Reducers for task execution (`step.runStarted` … `step.retryScheduled`) and compensation
 * (`step.compensation*`) events.
 * @internal
 */

import type { DomainEvent } from '../events'
import { sameEntry } from '../selectors'
import type { WizardState } from '../state'
import type { MachineEnv } from '../types'
import { omit } from '../util'
import { patchStep, toStepError, withSaga, withStep, withTimer } from './patch'

export function applyRun(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'step.runStarted':
      return withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['retryAt', 'entering', ...(ev.attempt === 1 ? (['error'] as const) : [])]),
        status: 'active',
        attempt: ev.attempt,
        runId: ev.runId,
        idempotencyKey: ev.idempotencyKey,
      }))
    case 'step.runSucceeded':
      return settleRun(state, ev.step)
    case 'step.runFailed':
      return settleRun(
        withStep(state, ev.step, (rec) => ({
          ...rec,
          error: toStepError(
            ev.error,
            ev.timedOut === true ? 'timeout' : 'run',
            ev.at,
            ev.attempt,
            ev.data,
          ),
        })),
        ev.step,
      )
    case 'step.idempotencyKeyRequested':
    case 'step.mapErrorStarted':
      // Bookkeeping only: the in-flight call is identified by its token; nothing to store.
      return state
    case 'step.retryScheduled':
      return withTimer(patchStep(state, ev.step, { retryAt: ev.dueAt }), ev.timerId, {
        at: ev.dueAt,
        fire: { type: 'timer.fired', timerId: ev.timerId },
        purpose: 'retry',
        step: ev.step,
      })
    default:
      return state
  }
}

/** A run result arrived: the step is no longer part of compensation phase 1 (`saga.settling`). */
function settleRun(state: WizardState, step: string): WizardState {
  if (state.saga.settling === undefined || !state.saga.settling.includes(step)) return state
  return withSaga(state, { ...state.saga, settling: state.saga.settling.filter((s) => s !== step) })
}

export function applySaga(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'step.compensationStarted': {
      const ref = { step: ev.step, runId: ev.runId ?? state.steps[ev.step]?.runId ?? 0 }
      return withSaga(patchStep(state, ev.step, { status: 'compensating' }), {
        ...state.saga,
        inFlight: ref,
      })
    }
    case 'step.compensated': {
      const ref = { step: ev.step, runId: ev.runId ?? state.saga.inFlight?.runId ?? 0 }
      return withSaga(patchStep(state, ev.step, { status: 'compensated' }), {
        ...omit(state.saga, ['inFlight']),
        compensated: state.saga.compensated.some((c) => sameEntry(c, ref))
          ? state.saga.compensated
          : [...state.saga.compensated, ref],
      })
    }
    case 'step.compensationFailed': {
      const ref = { step: ev.step, runId: ev.runId ?? state.saga.inFlight?.runId ?? 0 }
      return withSaga(
        withStep(state, ev.step, (rec) => ({
          ...rec,
          status: 'failed',
          error: toStepError(ev.error, 'compensate', ev.at),
        })),
        {
          ...omit(state.saga, ['inFlight']),
          failures: state.saga.failures.some((f) => sameEntry(f, ref))
            ? state.saga.failures
            : [...state.saga.failures, ref],
        },
      )
    }
    default:
      return state
  }
}
