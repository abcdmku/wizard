/**
 * `defineFlow(options)` — the authoring entry point (ADR-001 shape B).
 *
 * Returns a `FlowBuilder`: the six pre-bound step constructors plus `steps()`. Constructors
 * return plain step records with EVERY key materialised (`undefined` when unset) — the type
 * layer relies on required-or-undefined fields (ADR-001 F5). `steps()` returns the inert
 * `Flow` object and validates it once through `compile()` so unknown ids, dependency cycles
 * and nesting problems surface at definition time, for JS callers too.
 *
 * @packageDocumentation
 */

import { WizardError } from '../errors'
import { isBoundary } from './boundary'
import { compile } from './compile'
import type { AnyFlow, AnyStep, FlowBuilder, FlowDefinition } from './types'

/** Every key of a step record, in a fixed order (materialised on every step). */
type StepFields = Omit<AnyStep, 'kind' | '~types' | '~bound'>

const EMPTY_FIELDS: StepFields = {
  label: undefined,
  dependsOn: undefined,
  next: undefined,
  input: undefined,
  initial: undefined,
  validate: undefined,
  canEnter: undefined,
  canExit: undefined,
  enter: undefined,
  exit: undefined,
  run: undefined,
  output: undefined,
  retry: undefined,
  timeout: undefined,
  compensate: undefined,
  on: undefined,
  child: undefined,
  context: undefined,
  deps: undefined,
}
const FIELD_KEYS = Object.keys(EMPTY_FIELDS) as readonly (keyof StepFields)[]

function record(kind: AnyStep['kind'], fields: Partial<StepFields>): AnyStep {
  const out: Record<string, unknown> = { kind, '~types': undefined, '~bound': undefined }
  for (const key of FIELD_KEYS) out[key] = fields[key]
  return out as unknown as AnyStep
}

/** The untyped implementation behind `FlowBuilder` (types are applied once, below). */
interface RawBuilder {
  view(cfg?: Partial<StepFields>): AnyStep
  task(run: AnyStep['run'], cfg?: Partial<StepFields>): AnyStep
  wait(cfg?: Partial<StepFields>): AnyStep
  decision(cfg?: Partial<StepFields>): AnyStep
  flow(child: AnyFlow, cfg?: Partial<StepFields>): AnyStep
  final(cfg?: Partial<StepFields>): AnyStep
  steps(steps: Readonly<Record<string, AnyStep>>, opts?: { readonly start?: string }): AnyFlow
}

/**
 * Start a flow definition: `const s = defineFlow({ name, context, events?, deps?, …policies })`,
 * then `s.steps({ a: s.view({…}), … }, { start: 'a' })`. Every constructor is pre-bound to
 * the flow's context, events and deps, so hooks are typed without generics.
 * @public
 */
export function defineFlow<C, CIn, Ev = {}, D = unknown>(
  options: FlowDefinition<C, CIn, Ev, D>,
): FlowBuilder<C, CIn, Ev, D> {
  const problems = validateDefinition(options)
  if (problems.length > 0) {
    throw new WizardError('DEFINITION_INVALID', `defineFlow: ${problems.join('; ')}`, {
      issues: problems.map((message) => ({ message })),
    })
  }
  const raw: RawBuilder = {
    view: (cfg = {}) => record('view', cfg),
    task: (run, cfg = {}) => record('task', { ...cfg, run }),
    wait: (cfg = {}) => record('wait', cfg),
    decision: (cfg = {}) => record('decision', cfg),
    flow: (child, cfg = {}) => record('flow', { ...cfg, child }),
    final: (cfg = {}) => record('final', cfg),
    steps: (steps, opts) => {
      const flow: Record<string, unknown> = {
        '~types': undefined,
        name: options.name,
        ...(options.version !== undefined ? { version: options.version } : {}),
        context: options.context,
        ...(options.events !== undefined ? { events: options.events } : {}),
        ...(options.deps !== undefined ? { deps: options.deps } : {}),
        ...(options.onFailure !== undefined ? { onFailure: options.onFailure } : {}),
        ...(options.retry !== undefined ? { retry: options.retry } : {}),
        ...(options.autoRun !== undefined ? { autoRun: options.autoRun } : {}),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        ...(options.unmatchedEvents !== undefined
          ? { unmatchedEvents: options.unmatchedEvents }
          : {}),
        steps,
        ...(opts?.start !== undefined ? { start: opts.start } : {}),
      }
      const defined = flow as unknown as AnyFlow
      // Validate once at definition time (unknown ids, cycles, nesting); cached for createWizard.
      compile(defined)
      return defined
    },
  }
  return raw as unknown as FlowBuilder<C, CIn, Ev, D>
}

function validateDefinition(options: FlowDefinition<unknown, unknown, unknown, unknown>): string[] {
  const problems: string[] = []
  if (typeof options !== 'object' || options === null) return ['options must be an object']
  if (typeof options.name !== 'string' || options.name.length === 0) {
    problems.push("'name' must be a non-empty string")
  }
  if (
    options.version !== undefined &&
    !(Number.isInteger(options.version) && options.version >= 0)
  ) {
    problems.push("'version' must be a non-negative integer")
  }
  if (!isBoundary(options.context)) problems.push("'context' must be a boundary")
  if (options.deps !== undefined && !isBoundary(options.deps))
    problems.push("'deps' must be a boundary")
  if (options.events !== undefined) {
    if (typeof options.events !== 'object' || options.events === null) {
      problems.push("'events' must be an object of boundaries")
    } else {
      for (const [event, b] of Object.entries(options.events)) {
        if (!isBoundary(b)) problems.push(`events['${event}'] must be a boundary`)
      }
    }
  }
  return problems
}
