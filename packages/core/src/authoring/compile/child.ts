/** Compile a nested wizard and its input/output mappers. @internal */
import { isBoundary, toRuntimeBoundary } from '../boundary'
import type { AnyFlow, AnyStep } from '../types'
import { compileFlow } from './flow'
import { asHook, chain, hookField, unwrap } from './hooks'
import { describeName, isRecord, MAX_DEPTH, type Rec } from './shared'
import type { Problem, StepBuild, StepCtx, StepHooks } from './steps'

export function compileChild(
  raw: AnyStep,
  c: Rec,
  step: StepBuild,
  hooks: StepHooks,
  problem: Problem,
  sc: StepCtx,
): void {
  const child = (raw as unknown as Rec).child
  if (!isRecord(child) || !isRecord(child.steps)) {
    problem('a flow step needs a child wizard')
    return
  }
  const childFlow = child as unknown as AnyFlow
  const childPath = [...sc.ctx.path, step.id]
  if (sc.ctx.chain.includes(childFlow)) {
    sc.ctx.nesting.push({ code: 'NESTING_CYCLE', step: step.id })
    sc.problem(
      `wizard '${describeName(childFlow)}' embeds one of its ancestors (at step '${step.id}')`,
    )
  } else if (childPath.length > MAX_DEPTH) {
    sc.ctx.nesting.push({ code: 'NESTING_TOO_DEEP', step: step.id })
    sc.problem(`wizard nesting deeper than ${MAX_DEPTH} at '${childPath.join('/')}'`)
  } else
    step.child = compileFlow(childFlow, {
      ...sc.ctx,
      path: childPath,
      chain: [...sc.ctx.chain, childFlow],
    })
  if (typeof c.context !== 'function') problem("a flow step needs a 'context' function")
  else hooks.childContext = asHook<unknown>(c.context as (args: never) => unknown)
  hookField(c.deps, 'deps', problem, (h) => {
    hooks.childDeps = asHook<unknown>(h)
  })
  if (c.output !== undefined) {
    if (!isBoundary(c.output)) problem("'output' must be a boundary")
    else {
      const boundary = toRuntimeBoundary(c.output)
      step.output = boundary
      hooks.childOutput = (args) =>
        chain(boundary.parse(args.output), (r) => unwrap(r, `output of '${step.id}'`))
    }
  }
}
