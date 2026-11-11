/**
 * Child summaries: the compact status the parent's step record and Mirrors carry
 * (`ChildSummary`) and the failure a failed or cancelled child reports to its parent flow step.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import { deriveRuntimeResult, haltFailure, type RuntimeFailure } from '../machine/run-result'
import { progress } from '../machine/selectors'
import type { ChildSummary, SerializedError, WizardState } from '../machine/state'

/**
 * Compact child status for the parent's step record and Mirrors. `progress` is the `progress`
 * selector's ratio over the child's definition (completing steps excluded, skipped counts as
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

/** Why a child ended without output: its terminal failure, the error the parent step records, and the mapped data. */
export interface ChildFailure {
  readonly failure: RuntimeFailure
  readonly error: SerializedError
  readonly data?: unknown
}

/** The failure of a child that ended `failed` or `cancelled` (undefined otherwise). */
export function childFailure(state: WizardState): ChildFailure | undefined {
  if (state.status === 'halted') {
    const failure = haltFailure(state)
    return failure === undefined ? undefined : withData(failure, failure.error, failure.error.data)
  }
  const result = deriveRuntimeResult(state)
  if (result === undefined || result.status === 'done') return undefined
  const failure = result.failure
  switch (failure.kind) {
    case 'step':
      return withData(failure, failure.error, failure.error.data)
    case 'compensation':
      return withData(
        failure,
        failure.cause?.error ?? failure.compensation.failures[0]?.error ?? childFailed(state),
        failure.cause?.error.data,
      )
    case 'runtime':
      return withData(failure, failure.error, undefined)
    case 'cancelled':
      return withData(
        failure,
        {
          name: 'ChildFlowCancelled',
          message: `child flow '${state.flow.name}' was cancelled${failure.reason === undefined ? '' : `: ${failure.reason}`}`,
          code: 'CHILD_CANCELLED',
        },
        undefined,
      )
  }
}

function withData(failure: RuntimeFailure, error: SerializedError, data: unknown): ChildFailure {
  const { name, message, code } = error
  const serialized = code === undefined ? { name, message } : { name, message, code }
  return data === undefined ? { failure, error: serialized } : { failure, error: serialized, data }
}

function childFailed(state: WizardState): SerializedError {
  return {
    name: 'ChildFlowFailed',
    message: `child flow '${state.flow.name}' failed`,
    code: 'CHILD_FAILED',
  }
}
