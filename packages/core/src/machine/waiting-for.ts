/**
 * `waitingFor(def, state)` — what one run waits on from the outside: a user on a view, an external
 * event on a `waitFor` step (with its absolute `deadline` when the wait has a timeout), or a sleep
 * (a wait with no events that completes at its `deadline`). Entries are flat and located by `path`
 * (`[]` = this run); the runtime appends the entries of live child runs with their path. Pure and
 * derived, never stored; empty while nothing waits (not started, finished, compensating).
 *
 * @internal
 */

import type { CompiledWizard } from '../authoring/compiled'
import { isEventStep, isTerminal, readyViews } from './selectors'
import type { WizardState } from './state'

/** One thing a run waits on. */
export type WaitingFor =
  | { readonly kind: 'view'; readonly path: readonly string[]; readonly step: string }
  | {
      readonly kind: 'event'
      readonly path: readonly string[]
      readonly step: string
      readonly events: readonly string[]
      /** Absolute time (ms) the wait times out, when it declares a timeout. */
      readonly deadline?: number
    }
  | {
      readonly kind: 'sleep'
      readonly path: readonly string[]
      readonly step: string
      readonly deadline: number
    }

const ROOT: readonly string[] = []

export function waitingFor(def: CompiledWizard, state: WizardState): readonly WaitingFor[] {
  if (state.status === 'idle' || state.status === 'compensating' || isTerminal(state)) return []
  const out: WaitingFor[] = []
  for (const id of state.active) {
    const rec = state.steps[id]
    const step = def.steps[id]
    if (rec === undefined || rec.entering === true) continue
    if (step?.sleep !== undefined && rec.deadline !== undefined) {
      out.push({ kind: 'sleep', path: ROOT, step: id, deadline: rec.deadline })
      continue
    }
    if (!isEventStep(step)) continue
    const events = Object.keys(step.hooks.waitFor)
    const deadline = rec.deadline
    if (events.length > 0)
      out.push({
        kind: 'event',
        path: ROOT,
        step: id,
        events,
        ...(deadline !== undefined ? { deadline } : {}),
      })
  }
  if (state.nav.phase !== 'idle') return out
  const current = state.current === null ? undefined : state.steps[state.current]
  const listens = isEventStep(def.steps[current?.id ?? ''])
  if (current !== undefined && current.entering !== true && !listens)
    out.unshift({ kind: 'view', path: ROOT, step: current.id })
  else if (state.current === null)
    for (const view of readyViews(def, state)) out.push({ kind: 'view', path: ROOT, step: view })
  return out
}
