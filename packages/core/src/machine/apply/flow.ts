/**
 * Reducers for the flow-lifecycle events.
 * @internal
 */

import type { DomainEvent } from '../events'
import { initialState } from '../initial'
import { runInFlight } from '../selectors'
import type {
  CompensationFailureState,
  FlowFailureState,
  SagaState,
  SerializedError,
  WizardState,
} from '../state'
import type { MachineEnv } from '../types'
import { omit } from '../util'
import { patchStep, withSaga } from './patch'

/**
 * v0.2: a `when` predicate in flight for a pending activation belongs to a live flow. Once the
 * flow is done / cancelled / compensating nothing may enter or skip any more, so the in-flight
 * token is staled here (its late result is `result.ignored`, resume does not re-issue it).
 */
function dropPendingWhen(state: WizardState): WizardState {
  let next = state
  for (const id of Object.keys(state.steps)) {
    if (state.steps[id]?.when === 'pending') next = patchStep(next, id, {}, ['when'])
  }
  return next
}

export function applyFlow(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'flow.started':
      return { ...state, startedAt: ev.at }
    case 'flow.done': {
      const next = dropPendingWhen(
        ev.output !== undefined ? { ...state, output: ev.output } : state,
      )
      return {
        ...next,
        terminal: {
          status: 'done',
          ...(ev.output !== undefined ? { output: ev.output } : {}),
        },
      }
    }
    case 'flow.failed': {
      const failure: FlowFailureState =
        state.failure !== undefined && state.failure.step === ev.step
          ? state.failure
          : {
              ...(ev.step !== undefined ? { step: ev.step } : {}),
              error: ev.error,
              kind: 'runtime',
              at: ev.at,
              ...(ev.data !== undefined ? { data: ev.data } : {}),
            }
      const next = { ...omit(state, ['terminal']), failure }
      // A step failure under the halt policy is intentionally recoverable.  It
      // becomes terminal only when no failed step was recorded (for example an
      // auto-advance loop or another flow-level runtime failure).
      if (Object.values(state.steps).some((rec) => rec.status === 'failed')) return next
      return { ...next, terminal: { status: 'failed', failure } }
    }
    case 'flow.compensating': {
      const settling = state.active.filter((id) => runInFlight(state.steps[id]))
      const retried: ReadonlySet<string> = new Set(ev.plan)
      const saga: SagaState = {
        ...omit(state.saga, ['reason', 'outcome', 'inFlight']),
        failures: state.saga.failures.filter((f) => !retried.has(f.step)),
        settling,
        outcome: ev.outcome ?? 'failed',
        ...(ev.reason !== undefined ? { reason: ev.reason } : {}),
      }
      return dropPendingWhen(withSaga(omit(state, ['terminal']), saga))
    }
    case 'flow.compensated': {
      const next = withSaga(state, omit(state.saga, ['settling', 'inFlight']))
      const compensation = {
        outcome: ev.outcome,
        failures: state.saga.failures.map((ref) => compensationFailure(state, ref)),
      }
      const terminal =
        ev.outcome === 'cancelled'
          ? {
              status: 'cancelled' as const,
              ...(state.saga.reason !== undefined ? { reason: state.saga.reason } : {}),
              compensation,
            }
          : {
              status: 'failed' as const,
              ...(state.failure !== undefined ? { failure: state.failure } : {}),
              compensation,
            }
      return { ...next, terminal }
    }
    case 'flow.cancelled': {
      const next = dropPendingWhen(omit(state, ['terminal']))
      return {
        ...next,
        terminal: {
          status: 'cancelled',
          ...(ev.reason !== undefined ? { reason: ev.reason } : {}),
        },
      }
    }
    case 'flow.resumed':
    case 'flow.status':
      return state
    case 'flow.reset':
      return initialState(env, {
        instanceId: state.instanceId,
        context: state.context,
        now: ev.at,
        epoch: state.epoch,
        ...(state.correlationId !== undefined ? { correlationId: state.correlationId } : {}),
      })
    default:
      return state
  }
}

function compensationFailure(
  state: WizardState,
  ref: { readonly step: string; readonly runId: number },
): CompensationFailureState {
  const error = state.steps[ref.step]?.error
  const serialized: SerializedError =
    error === undefined
      ? {
          name: 'CompensationError',
          message: `compensation for '${ref.step}' failed`,
          code: 'COMPENSATION_FAILED',
        }
      : {
          name: error.name,
          message: error.message,
          ...(error.code !== undefined ? { code: error.code } : {}),
        }
  return { step: ref.step, runId: ref.runId, error: serialized }
}
