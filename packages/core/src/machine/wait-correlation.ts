/** Event correlation and the atomic-delivery rule of `send`. @internal */

import type { Batch } from './batch'
import type { ResultToken } from './commands'
import { isTerminal } from './selectors'
import type { WizardState } from './state'
import { stepIndex } from './step-index'

/** Resolve an event correlation id without letting an extractor escape the machine. */
export function correlationOf(
  b: Batch,
  event: string,
  payload: unknown,
): string | undefined | 'error' {
  const extract = b.env.def.correlate?.[event]
  if (extract === undefined) return undefined
  try {
    const value = extract(payload)
    return typeof value === 'string' ? value : undefined
  } catch {
    return 'error'
  }
}

/**
 * One delivery is atomic: once a handler ended the run, started compensation or
 * halted it (a step failed since `failedBefore`), the remaining listeners, deferred results, the
 * flow-level handler and inbox drains of that delivery are dropped. A run halted before the
 * `send` still delivers to its active waits (D1).
 */
export function deliveryStopped(state: WizardState, failedBefore: number): boolean {
  return (
    isTerminal(state) ||
    state.status === 'compensating' ||
    stepIndex(state.steps).failed > failedBefore
  )
}

/**
 * A handler call planned for the event a `send` delivered must not start once that delivery
 * stopped: an earlier listener's synchronous result halted or ended the run before its turn.
 */
export function deliveryCallStopped(state: WizardState, token: ResultToken): boolean {
  return token.failedAtDelivery !== undefined && deliveryStopped(state, token.failedAtDelivery)
}
