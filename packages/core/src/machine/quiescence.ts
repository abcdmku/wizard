/**
 * Quiescence: when a drained run can finish (`flow.done`), and when it is stuck because a join
 * waits on steps that nothing can complete any more (the join fails `DEPS_UNREACHABLE`).
 * The interpreter sends `settle` when `settles(def, state)` holds and nothing is in flight.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import { unmetNeeds } from './needs'
import { depsSatisfied } from './selectors'
import type { WizardState } from './state'
import { stepIndex } from './step-index'

/** Nothing runs and nothing is queued: no active step, no transition, no deferred advance. */
function quiescent(state: WizardState): boolean {
  return (
    state.startedAt !== null &&
    (state.status === 'waiting' || state.status === 'running') &&
    state.active.length === 0 &&
    state.nav.phase === 'idle' &&
    (state.nav.deferred?.length ?? 0) === 0
  )
}

/** No activated work remains; unselected branches do not prevent completion. */
export function canFinish(_def: CompiledFlow, state: WizardState): boolean {
  const index = stepIndex(state.steps)
  return (
    quiescent(state) &&
    index.pending.length === 0 &&
    index.whenPending === 0 &&
    index.invalidated === 0
  )
}

/** A join that can never enter: its unmet needs, and the routing steps that decided against them. */
export interface StuckJoin {
  readonly step: string
  readonly deps: readonly string[]
  readonly routers: readonly string[]
}

/**
 * Quiescent, yet every activated step waits on needs that nothing can complete any more: the
 * first such join in arrival order (undefined = not stuck). `routers` are the decided steps
 * whose declared `targets` named one of those producers.
 */
export function stuckJoin(def: CompiledFlow, state: WizardState): StuckJoin | undefined {
  const index = stepIndex(state.steps)
  if (!quiescent(state) || index.whenPending > 0) return undefined
  if (index.pending.some((id) => depsSatisfied(def, state, id))) return undefined
  const step = index.pending[0]
  if (step === undefined) return undefined
  const deps = unmetNeeds(def, state, step)
  const routers = def.order.filter((id) => {
    const next = def.steps[id]?.next
    const status = state.steps[id]?.status
    return (
      next?.kind === 'dynamic' &&
      (status === 'done' || status === 'skipped') &&
      deps.some((dep) => next.targets?.includes(dep) === true)
    )
  })
  return { step, deps, routers }
}

/** The drained run has something to settle: it can finish, or a join is stuck. */
export function settles(def: CompiledFlow, state: WizardState): boolean {
  return canFinish(def, state) || stuckJoin(def, state) !== undefined
}
