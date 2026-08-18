/**
 * Status derivation (§5.1) — the ONE place wizard status is computed, after every event.
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import type { DomainEvent } from '../events'
import type { WizardState, WizardStatus } from '../state'

export function deriveStatus(
  def: CompiledFlow,
  state: WizardState,
  event: DomainEvent,
): WizardStatus {
  switch (event.type) {
    case 'flow.done':
      return 'done'
    case 'flow.compensated':
      return event.outcome
    case 'flow.cancelled':
      return 'cancelled'
    case 'flow.failed':
      return 'failed'
    case 'flow.compensating':
      return 'compensating'
    case 'flow.reset':
      return 'idle'
    default:
      break
  }
  const prev = state.status
  if (prev === 'done' || prev === 'cancelled' || prev === 'compensating') return prev
  const anyFailed = Object.values(state.steps).some((r) => r.status === 'failed')
  if (prev === 'failed' && event.type !== 'step.invalidated') {
    // Halt: failed while ANY step record is failed; a retried step becomes active again and the
    // flow recovers. Nothing failed and nothing active = a terminal failure (compensated, loop).
    // v0.2: invalidating the failed step (§9.3) recovers too — it falls through to the general rule.
    if (anyFailed || state.active.length === 0) return 'failed'
  } else if (anyFailed && def.policies.onFailure === 'halt') {
    return 'failed'
  }
  let waiting = false
  for (const id of state.active) {
    const rec = state.steps[id]
    if (rec === undefined) continue
    switch (rec.kind) {
      case 'task':
      case 'decision':
      case 'final':
        return 'running'
      case 'flow':
        if (rec.child === undefined || rec.child.status !== 'waiting') return 'running'
        waiting = true
        break
      default:
        waiting = true
    }
  }
  if (waiting) return 'waiting'
  return state.startedAt !== null ? 'waiting' : 'idle'
}
