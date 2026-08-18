/**
 * `apply` — the fold. One reducer per event type (exhaustive switch), then a
 * post-pass that recomputes `active`, `current`, `status` (`deriveStatus`),
 * `updatedAt` and `seq` after EVERY event.
 *
 * `apply` never emits events and never looks at hooks; it only reads the
 * compiled flow for structural facts (kind, dependsOn, initial input, which
 * steps have a `compensate` hook).
 *
 * @internal
 */

import type { DomainEvent } from '../events'
import type { WizardState } from '../state'
import type { MachineEnv } from '../types'
import { applyChild, applyData, applyEvents, applyTimers } from './data'
import { applyFlow } from './flow'
import { withNav } from './patch'
import { applyRun, applySaga } from './run'
import { deriveStatus } from './status'
import { applyStep } from './step'
import { applyTransition } from './transition'

export { deriveStatus } from './status'

function reduce(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'flow.started':
    case 'flow.done':
    case 'flow.failed':
    case 'flow.compensating':
    case 'flow.compensated':
    case 'flow.cancelled':
    case 'flow.resumed':
    case 'flow.reset':
    case 'flow.status':
      return applyFlow(env, state, ev)
    case 'transition.started':
    case 'transition.phase':
    case 'transition.committed':
    case 'transition.rejected':
    case 'transition.failed':
      return applyTransition(env, state, ev)
    case 'step.arrived':
    case 'step.entered':
    case 'step.enterCompleted':
    case 'step.exited':
    case 'step.done':
    case 'step.failed':
    case 'step.skipped':
    case 'step.whenStarted':
    case 'step.whenEvaluated':
    case 'step.invalidated':
    case 'step.cancelled':
    case 'step.validated':
    case 'step.validationFailed':
    case 'step.guardEvaluated':
      return applyStep(env, state, ev)
    case 'step.idempotencyKeyRequested':
    case 'step.runStarted':
    case 'step.runSucceeded':
    case 'step.mapErrorStarted':
    case 'step.runFailed':
    case 'step.retryScheduled':
      return applyRun(env, state, ev)
    case 'step.compensationStarted':
    case 'step.compensated':
    case 'step.compensationFailed':
      return applySaga(env, state, ev)
    case 'input.changed':
    case 'context.changed':
      return applyData(env, state, ev)
    case 'event.received':
    case 'event.rejected':
    case 'event.delivered':
    case 'event.buffered':
    case 'event.expired':
    case 'event.dropped':
    case 'event.flowDelivered':
    case 'event.handlerResultIgnored':
    case 'event.handlerFailed':
      return applyEvents(env, state, ev)
    case 'timer.scheduled':
    case 'timer.fired':
    case 'timer.cleared':
      return applyTimers(env, state, ev)
    case 'child.started':
    case 'child.summary':
    case 'child.command':
      return applyChild(env, state, ev)
    case 'command.rejected':
    case 'result.ignored':
    case 'persist.failed':
      return state
    default: {
      const _exhaustive: never = ev
      return _exhaustive
    }
  }
}

/**
 * Events that only an external message can produce (a command, a `send`, a
 * timer, a resume): they mark the boundary of an auto-advance chain, so the
 * `hops` counter restarts there (plan §8.3: "capped at 1000 hops per command").
 */
const HOP_RESET_EVENTS: ReadonlySet<DomainEvent['type']> = new Set([
  'flow.started',
  'flow.resumed',
  'event.received',
  'event.rejected',
  'input.changed',
  'timer.fired',
  'command.rejected',
])

function resetHops(state: WizardState, event: DomainEvent): WizardState {
  if (!HOP_RESET_EVENTS.has(event.type) || (state.nav.hops ?? 0) === 0) return state
  return withNav(state, { ...state.nav, hops: 0 })
}

export function apply(env: MachineEnv, state: WizardState, event: DomainEvent): WizardState {
  const reduced = resetHops(reduce(env, state, event), event)
  if (event.type === 'flow.reset') {
    return { ...reduced, seq: event.seq, updatedAt: event.at }
  }
  const active = Object.keys(reduced.steps).filter((id) => reduced.steps[id]?.status === 'active')
  // Keep activation order stable: previously active ids first (in their order), then newcomers.
  const ordered = [
    ...reduced.active.filter((id) => active.includes(id)),
    ...active.filter((id) => !reduced.active.includes(id)),
  ]
  const current =
    reduced.current !== null && reduced.steps[reduced.current]?.status === 'active'
      ? reduced.current
      : null
  const withActive: WizardState = { ...reduced, active: ordered, current }
  return {
    ...withActive,
    status: deriveStatus(env.def, withActive, event),
    seq: event.seq,
    updatedAt: event.at,
  }
}
