/** Resolve one callback-returned adapter before applying the step's output boundary. @internal */
import { toRuntimeBoundary } from '../authoring/boundary'
import type { CompiledStep, HookArgs, RuntimeBoundary } from '../authoring/compiled'
import { isRunAdapter, RUN_ADAPTER } from '../authoring/run-adapter'
import { codedError, unwrapBoundary } from './errors'
import { chain, getThen, type Then } from './thenable'

export function resolveRunOutput(value: unknown, step: CompiledStep, args: HookArgs): unknown {
  const resolve = (outcome: unknown): unknown => {
    if (!isRunAdapter(outcome)) return parseOutput(outcome, step.output)
    if (args.signal.aborted) {
      throw args.signal.reason ?? codedError('AbortError', 'ABORTED', `step '${step.id}' aborted`)
    }
    const adapter = outcome[RUN_ADAPTER]
    const output = step.output ?? toRuntimeBoundary(adapter.output)
    return chain(adapter.run(args), (result) => parseOutput(result, output))
  }
  const then = getThen(value)
  if (then === undefined) return resolve(value)
  // A custom thenable must not start adapter work after its first settlement.
  return {
    // biome-ignore lint/suspicious/noThenProperty: preserves synchronous custom-thenable settlement
    then(accept: Parameters<Then>[0], reject: Parameters<Then>[1]): void {
      let settled = false
      then.call(
        value,
        (outcome: unknown) => {
          if (settled) return
          settled = true
          try {
            const result = resolve(outcome)
            const next = getThen(result)
            if (next === undefined) accept(result)
            else next.call(result, accept, reject)
          } catch (error) {
            reject(error)
          }
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          reject(error)
        },
      )
    },
  }
}

function parseOutput(value: unknown, output: RuntimeBoundary | undefined): unknown {
  if (output === undefined) return value
  return chain(output.parse(value), (result) => unwrapBoundary(result, 'output'))
}
