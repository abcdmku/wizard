/**
 * Status derivation — the ONE place run status is computed, after every event.
 * O(active) per event: the halt check reads the derived step index, never every record.
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import { childActivity } from '../child-activity'
import type { DomainEvent } from '../events'
import { isEventStep } from '../selectors'
import type { RunStatus, WizardState } from '../state'
import { stepIndex } from '../step-index'

export function deriveStatus(def: CompiledFlow, state: WizardState, event: DomainEvent): RunStatus {
  switch (event.type) {
    case 'flow.done':
      return 'done'
    case 'flow.compensated':
      return event.status
    case 'flow.cancelled':
      return 'cancelled'
    case 'flow.failed':
      return 'failed'
    case 'flow.halted':
      return 'halted'
    case 'flow.compensating':
      return 'compensating'
    case 'flow.reset':
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
function activityStatus(def: CompiledFlow, state: WizardState): RunStatus {
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
      case 'flow': {
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
