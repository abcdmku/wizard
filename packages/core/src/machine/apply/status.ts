/**
 * Status derivation — the ONE place run status is computed, after every event.
 * O(active) per event: the halt check reads the derived step index, never every record.
 * @internal
 */

import type { CompiledWizard } from '../../authoring/compiled'
import { childActivity } from '../child-activity'
import type { DomainEvent } from '../events'
import { isEventStep } from '../selectors'
import type { RunStatus, WizardState } from '../state'
import { stepIndex } from '../step-index'

export function deriveStatus(
  def: CompiledWizard,
  state: WizardState,
  event: DomainEvent,
): RunStatus {
  switch (event.type) {
    case 'run.done':
      return 'done'
    case 'run.compensated':
      return event.status
    case 'run.cancelled':
      return 'cancelled'
    case 'run.failed':
      return 'failed'
    case 'run.halted':
      return 'halted'
    case 'run.compensating':
      return 'compensating'
    case 'run.reset':
      return 'idle'
    default:
      break
  }
  const prev = state.status
  if (prev === 'done' || prev === 'cancelled' || prev === 'failed' || prev === 'compensating')
    return prev
  // A halt lasts while a failed record remains; retry / skip / invalidate clear it.
  if (prev === 'halted' && stepIndex(state.steps).failed > 0) return 'halted'
  return activityStatus(def, state)
}

/** Status from the active steps: running > halted child > waiting (views, waits, waiting children). */
function activityStatus(def: CompiledWizard, state: WizardState): RunStatus {
  let waiting = false
  let childHalted = false
  for (const id of state.active) {
    const rec = state.steps[id]
    if (rec === undefined) continue
    if (isEventStep(def.steps[id]) || def.steps[id]?.sleep !== undefined) {
      waiting = true
      continue
    }
    switch (rec.kind) {
      case 'step':
        return 'running'
      case 'child': {
        const child = childActivity(rec)
        if (child === 'halted') childHalted = true
        else if (child === 'waiting') waiting = true
        else return 'running'
        break
      }
      default:
        waiting = true
    }
  }
  if (childHalted) return 'halted'
  if (waiting) return 'waiting'
  return state.startedAt !== null ? 'waiting' : 'idle'
}
