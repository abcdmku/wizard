/**
 * Child summaries: the compact status the parent's step record and Mirrors carry
 * (`ChildSummary`) and the failure a failed child reports to its parent flow step.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import { progress } from '../machine/selectors'
import type { ChildSummary, SerializedError, WizardState } from '../machine/state'

/**
 * Compact child status for the parent's step record and Mirrors. `progress` is the `progress`
 * selector's ratio over the child's definition (v0.2 §9.6: finals excluded, skipped counts as
 * done, 1 once the child is done).
 */
export function summarize(state: WizardState, def: CompiledFlow): ChildSummary {
  return {
    status: state.status,
    current: state.current,
    progress: progress(state, def).ratio,
    seq: state.seq,
  }
}

/** The error of the (most recently failed) failed step, or a generic child failure. */
export function failureOf(state: WizardState): SerializedError {
  let failed: WizardState['steps'][string] | undefined
  for (const rec of Object.values(state.steps)) {
    if (rec.status !== 'failed' || rec.error === undefined) continue
    if (failed?.error === undefined || rec.error.at >= failed.error.at) failed = rec
  }
  if (failed?.error !== undefined) {
    const { name, message, code } = failed.error
    return code === undefined ? { name, message } : { name, message, code }
  }
  return {
    name: 'ChildFlowFailed',
    message: `child flow '${state.flow.name}' failed`,
    code: 'CHILD_FAILED',
  }
}
