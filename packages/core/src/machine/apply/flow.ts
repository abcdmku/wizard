/**
 * Reducers for the flow-lifecycle events.
 * @internal
 */

import type { DomainEvent } from '../events'
import { initialState } from '../initial'
import { runInFlight } from '../selectors'
import type { SagaState, WizardState } from '../state'
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
    case 'flow.done':
      return dropPendingWhen(ev.output !== undefined ? { ...state, output: ev.output } : state)
    case 'flow.failed':
      return state
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
      return dropPendingWhen(withSaga(state, saga))
    }
    case 'flow.compensated':
      return withSaga(state, omit(state.saga, ['settling', 'inFlight']))
    case 'flow.cancelled':
      return dropPendingWhen(state)
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
