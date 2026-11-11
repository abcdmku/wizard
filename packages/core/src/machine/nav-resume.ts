/** Recover the automatic continuation of work whose completion was already committed. */
import type { Batch } from './batch'
import { rec, stepDef } from './batch'
import { startAuto } from './nav'
import { schedulingFrozen } from './scheduler'
import type { NavState } from './state'

export function resumeAutoNavigation(b: Batch, saved: NavState): void {
  if (
    saved.cause !== 'auto' ||
    saved.phase === 'idle' ||
    saved.from == null ||
    b.state.nav.phase !== 'idle' ||
    schedulingFrozen(b)
  )
    return
  const from = saved.from
  const source = rec(b, from)
  const def = stepDef(b, from)
  if (def === undefined || def.kind === 'view') return
  if (source?.status !== 'done' && source?.status !== 'skipped') return
  // A stored empty list is a resolved terminal route. Undefined asks only next() again.
  startAuto(b, from, saved.targets)
}
