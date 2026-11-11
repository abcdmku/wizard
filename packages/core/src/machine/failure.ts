/** Exhausted failures, alternate failure edges, and the run failure policy. @internal */

import type { Batch } from './batch'
import { emit, stepDef } from './batch'
import type { StepFailureKind } from './event-lifecycle'
import { startAuto } from './nav'
import { activateFeeds, propagateSkipped } from './needs'
import { startCompensation } from './saga'
import { clearStepTimers, schedule } from './scheduler'
import type { SerializedError } from './state'

/** Retain the failure on a skipped record when a static fallback handles it. */
export function failStep(
  b: Batch,
  step: string,
  error: SerializedError,
  kind: StepFailureKind,
  data?: unknown,
): void {
  clearStepTimers(b, step)
  const fallback = stepDef(b, step)?.fallback
  if (fallback !== undefined && stepDef(b, fallback) !== undefined) {
    emit(b, {
      type: 'step.skipped',
      step,
      reason: 'fallback',
      next: fallback,
      error,
      kind,
      ...(data !== undefined ? { data } : {}),
    })
    activateFeeds(b, step)
    propagateSkipped(b, [step])
    startAuto(b, step, fallback)
    schedule(b)
    return
  }
  emit(b, { type: 'step.failed', step, error, kind, ...(data !== undefined ? { data } : {}) })
  if (b.env.def.policies.onFailure === 'compensate' && kind !== 'interrupted') {
    startCompensation(b, `step-failed:${step}`, 'failed')
    return
  }
  emit(b, { type: 'run.halted', step, error, ...(data !== undefined ? { data } : {}) })
}
