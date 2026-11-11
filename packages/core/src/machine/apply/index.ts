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
import { omit } from '../util'
import { applyData } from './data'
import { applyFlow } from './flow'
import { withNav } from './patch'
import { applyRun, applySaga } from './run'
import { deriveStatus } from './status'
import { applyStep } from './step'
import { applyTransition } from './transition'

export { deriveStatus } from './status'

function reduce(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  const type = ev.type
  if (type.startsWith('flow.')) return applyFlow(env, state, ev)
  if (type.startsWith('transition.')) return applyTransition(env, state, ev)
  if (type.startsWith('step.compensat')) return applySaga(env, state, ev)
  if (
    type === 'step.idempotencyKeyRequested' ||
    type === 'step.mapErrorStarted' ||
    type === 'step.retryScheduled' ||
    type.startsWith('step.each') ||
    type.startsWith('step.run')
  )
    return applyRun(env, state, ev)
  if (type.startsWith('step.')) return applyStep(env, state, ev)
  return applyData(env, state, ev)
}

/**
 * Events that only an external message can produce (a command, a `send`, a timer, a resume):
 * they are async boundaries, so the auto-advance `hops` guard restarts there. An asynchronously
 * settled hook restarts it too (`Batch.hopBoundary` → `transition.started.hops`).
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
  return withNav(state, { ...omit(state.nav, ['trail']), hops: 0 })
}

export function apply(env: MachineEnv, state: WizardState, event: DomainEvent): WizardState {
  const reduced = resetHops(reduce(env, state, event), event)
  if (event.type === 'flow.reset') {
    return { ...reduced, seq: event.seq, updatedAt: event.at }
  }
  const current =
    reduced.current !== null && reduced.steps[reduced.current]?.status === 'active'
      ? reduced.current
      : null
  const withCurrent: WizardState = current === reduced.current ? reduced : { ...reduced, current }
  return {
    ...withCurrent,
    status: deriveStatus(env.def, withCurrent, event),
    seq: event.seq,
    updatedAt: event.at,
  }
}
