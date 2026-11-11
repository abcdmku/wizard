/**
 * `settle` (sent by the interpreter once a drained run has nothing in flight): finish the flow
 * with its output, or fail a join that can never run (D5, `DEPS_UNREACHABLE`).
 * @internal
 */

import type { Batch } from '../batch'
import { emit } from '../batch'
import { canFinish, type StuckJoin, stuckJoin } from '../quiescence'
import { failStep } from '../scheduler'
import type { StepRecord } from '../state'

export function onSettle(b: Batch): void {
  if (canFinish(b.env.def, b.state)) {
    finish(b)
    return
  }
  const stuck = stuckJoin(b.env.def, b.state)
  if (stuck !== undefined) failStuckJoin(b, stuck)
}

/** `flow.done` with the selector's value, else the output of the last completed sink. */
function finish(b: Batch): void {
  const state = b.state
  let last: StepRecord | undefined
  for (const id of b.env.def.sinks) {
    const step = state.steps[id]
    if (step?.status !== 'done') continue
    if (last === undefined || (step.completedSeq ?? 0) >= (last.completedSeq ?? 0)) last = step
  }
  try {
    const output =
      b.env.def.output === undefined ? last?.output : b.env.def.output({ context: state.context })
    if (output !== null && typeof output === 'object' && 'then' in output) {
      Promise.resolve(output).catch(() => {})
      throw new Error('Flow output selectors must be synchronous; perform async work in a step')
    }
    emit(b, { type: 'flow.done', ...(output === undefined ? {} : { output }) })
  } catch (error) {
    emit(b, {
      type: 'flow.failed',
      error: {
        name: 'OutputError',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

/** The join fails under the flow's failure policy; `skip(join)` lets the run finish without it. */
function failStuckJoin(b: Batch, { step, deps, routers }: StuckJoin): void {
  const quoted = (ids: readonly string[]) => ids.map((id) => `'${id}'`).join(', ')
  const routed = routers.length > 0 ? `; ${quoted(routers)} routed elsewhere` : ''
  failStep(
    b,
    step,
    {
      name: 'WizardError',
      code: 'DEPS_UNREACHABLE',
      message: `step '${step}' waits on ${quoted(deps)}, which can no longer complete${routed}`,
    },
    'guard',
  )
}
