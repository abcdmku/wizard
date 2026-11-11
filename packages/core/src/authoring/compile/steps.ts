/** Compile a constructor record, separating graph structure from behavior. @internal */
import type { CompiledStep } from '../compiled'
import type { AnyStep } from '../types'
import { compileBehaviors } from './behaviors'
import { compileEdges } from './edges'
import type { StepGraph } from './graph'
import { compileProse, isRecord, type Mutable, NO_EXPOSE, type Rec } from './shared'
import { compileStepHooks } from './step-hooks'
import { compileView } from './view'
import type { Ctx } from './wizard'

export interface StepCtx {
  readonly ctx: Ctx
  readonly problem: (message: string) => void
  readonly ids: ReadonlySet<string>
  readonly events: ReadonlySet<string>
  readonly graph: StepGraph
}

export type StepBuild = Mutable<CompiledStep>
export type StepHooks = Mutable<CompiledStep['hooks']>
export type Problem = (message: string) => void

const COMMON = [
  'label',
  'description',
  'meta',
  'next',
  'targets',
  'needs',
  'when',
  'enter',
  'exit',
  'on',
]
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  view: [...COMMON, 'input', 'initial', 'validate', 'canEnter', 'canExit'],
  step: [
    ...COMMON,
    'run',
    'waitFor',
    'sleep',
    'each',
    'key',
    'concurrency',
    'output',
    'retry',
    'timeout',
    'compensate',
    'idempotencyKey',
    'mapError',
    'fallback',
  ],
  child: [...COMMON, 'context', 'deps', 'output', 'each', 'key', 'concurrency', 'fallback'],
}

export function compileStep(id: string, raw: AnyStep, sc: StepCtx): CompiledStep {
  const problem: Problem = (message) => sc.problem(`step '${id}': ${message}`)
  const hooks: StepHooks = {}
  const step: StepBuild = { id, kind: raw.kind, next: { kind: 'none' }, hooks, expose: NO_EXPOSE }
  if (!isRecord(raw.config)) {
    problem('a step requires an object config')
    return step
  }
  const config = raw.config as Rec
  const allowed = FIELDS[raw.kind] ?? []
  for (const key of Object.keys(config)) {
    if (!allowed.includes(key)) problem(`'${key}' is not an option of a ${raw.kind} step`)
  }
  if (config.label !== undefined) {
    if (typeof config.label === 'string') step.label = config.label
    else problem("'label' must be a string")
  }
  compileProse(config, step, problem)
  compileEdges(id, config, step, hooks, problem, sc)
  compileStepHooks(config, step, hooks, problem, sc)
  if (raw.kind === 'view') compileView(config, step, hooks, problem)
  else compileBehaviors(raw, config, step, hooks, problem, sc)
  return step
}
