import type { AnyFlow, FlowFailure, FlowOutput, FlowRun, RunResult } from '@openwizard/core'
import { Effect } from 'effect'

/** Await the terminal result of an existing FlowRun in the Effect v4 error channel. @public */
export function awaitResult<F extends AnyFlow>(
  run: FlowRun<F>,
): Effect.Effect<FlowOutput<F>, FlowFailure<F>> {
  return Effect.callback<FlowOutput<F>, FlowFailure<F>>((resume) => {
    let unsubscribe: (() => void) | undefined
    let settled = false

    const finish = (result: RunResult<F>): void => {
      if (settled) return
      settled = true
      if (result.status === 'done') resume(Effect.succeed(result.output))
      else resume(Effect.fail(result.failure))
    }

    try {
      const current = run.result()
      if (current !== undefined) finish(current)
      else unsubscribe = run.subscribeResult(finish)
    } catch (error) {
      resume(Effect.die(error))
    }

    return Effect.sync(() => unsubscribe?.())
  })
}

/** Start an existing FlowRun and await its terminal result as an Effect v4 value. @public */
export function execute<F extends AnyFlow>(
  run: FlowRun<F>,
): Effect.Effect<FlowOutput<F>, FlowFailure<F>> {
  return Effect.flatMap(
    Effect.promise(() => run.start()),
    (started) => {
      if (started.ok) return awaitResult(run)
      return Effect.die(new Error(started.message))
    },
  )
}
