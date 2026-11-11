/** Deliver committed facts and transient item completion counters to observers. */
import type { DomainEvent } from '../machine/events'
import type { WizardState } from '../machine/state'

export function emitCommittedEvents(
  batch: readonly DomainEvent[],
  state: WizardState,
  emit: (event: DomainEvent) => void,
  progress: (step: string, value: unknown) => void,
): void {
  for (const event of batch) emit(event)
  for (const event of batch) {
    if (event.type !== 'step.eachItemCompleted') continue
    const each = state.steps[event.step]?.each
    if (each !== undefined) progress(event.step, { done: each.done, total: each.items.length })
  }
}
