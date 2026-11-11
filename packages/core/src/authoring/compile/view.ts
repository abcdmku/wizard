/** Compile the fields unique to a view step. @internal */

import { isBoundary, toRuntimeBoundary } from '../boundary'
import type { CompiledStep, Hook } from '../compiled'
import type { Issue } from '../types'
import { asHook, hookField } from './hooks'
import type { Mutable, Rec } from './shared'

type Build = Mutable<CompiledStep>
type Hooks = Mutable<CompiledStep['hooks']>
type Problem = (message: string) => void

export function compileView(s: Rec, step: Build, hooks: Hooks, problem: Problem): void {
  if (s.input !== undefined) {
    if (isBoundary(s.input)) step.input = toRuntimeBoundary(s.input)
    else problem("'input' must be a boundary")
  }
  if (typeof s.initial === 'function')
    hooks.initial = asHook<unknown>(s.initial as (args: never) => unknown)
  else if (s.initial !== undefined) step.initial = s.initial
  hookField(s.validate, 'validate', problem, (h) => {
    // The pipeline hands the parsed value in as `input`; the DSL calls it `output`.
    hooks.validate = (args) => (h as Hook<void | readonly Issue[]>)({ ...args, output: args.input })
  })
}
