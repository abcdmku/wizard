/**
 * `compile(flow)` — turns an inert `Flow` into the `CompiledFlow` the machine and the
 * interpreter consume, validating it on the way.
 *
 * Hard problems (thrown together as ONE `WizardError` listing ALL of them, nested flows
 * included): unknown ids in `next` / `dependsOn` / `timeout.next` / `start`, a `final` with
 * `next`, dependency cycles, a `wait` that can never complete (no handlers, no timeout), a
 * step-level or flow-level handler (`on`, `correlate`) for an undeclared event, fields a kind
 * does not accept (per-kind allow-lists, e.g. `input` on a task, `when` on a final), malformed
 * hooks/policies. The error code is `NESTING_CYCLE` (a flow embeds an ancestor) or
 * `NESTING_TOO_DEEP` (deeper than 8) when such a problem is among them, `DEFINITION_INVALID`
 * otherwise — nothing aborts on the first nested problem.
 *
 * v0.2: `on` compiles for every kind (`hooks.on`; a handler's result reaches the machine RAW —
 * `machine/wait.ts` applies the per-kind contract: `{ keep } / { next } / { done } / { fail }`
 * for waits, `{ next }` for views, `void` elsewhere, anything else `event.handlerResultIgnored`);
 * `when` → `hooks.when`; a task's `idempotent` → `idempotent: true` (+ `hooks.idempotencyKey`
 * for the function form) and `mapError` → `hooks.mapError` (called with `(args.error, args)`);
 * the definition header's `on` / `correlate` → `def.on` / `def.correlate`.
 *
 * Warnings (never thrown; `compile(flow, { onWarning })`, reused by `inspect()`):
 * `UNREACHABLE` (no path from `start`), `NEVER_ACTIVATES` (`dependsOn` but no incoming edge),
 * `NAV_CYCLE` (a cycle through static `next` / `timeout.next` edges — allowed, reported).
 * Dynamic `next` functions may target any step, so a reachable dynamic step silences the
 * reachability analysis.
 *
 * Flow-step mappers (`context`, `deps`) are compiled RAW: the executor / child bridge parse
 * their values through the child's boundaries exactly once, at child creation.
 *
 * Results are cached per `Flow` object (`defineFlow().steps()` compiles eagerly, so
 * `createWizard` never compiles twice).
 *
 * @packageDocumentation
 */

import { WizardError } from '../../errors'
import type { CompiledFlow } from '../compiled'
import type { AnyFlow } from '../types'
import { compileFlow, type NestingProblem } from './flow'
import { describeName } from './shared'

/**
 * A static-analysis warning about a flow (advisory; never thrown).
 * @public
 */
export interface FlowWarning {
  readonly code: 'UNREACHABLE' | 'NEVER_ACTIVATES' | 'NAV_CYCLE'
  readonly message: string
  /** Step the warning is about. */
  readonly step?: string
  /** Wizard path of the flow the step belongs to (`[]` = root). */
  readonly path: readonly string[]
}

/**
 * `compile()` options.
 * @public
 */
export interface CompileOptions {
  readonly onWarning?: (warning: FlowWarning) => void
}

/** @internal Cached result of analysing one flow object. */
export interface Analysis {
  readonly compiled: CompiledFlow
  readonly warnings: readonly FlowWarning[]
}

const cache = new WeakMap<object, Analysis>()

/**
 * Compile (and validate) a flow. Throws `WizardError('DEFINITION_INVALID' | 'NESTING_CYCLE' |
 * 'NESTING_TOO_DEEP')` listing every problem; reports warnings through `options.onWarning`.
 * Cached per flow object.
 * @public
 */
export function compile(flow: AnyFlow, options: CompileOptions = {}): CompiledFlow {
  const analysis = analyze(flow)
  if (options.onWarning !== undefined) for (const w of analysis.warnings) options.onWarning(w)
  return analysis.compiled
}

/** @internal Compile + warnings, cached per flow object. */
export function analyze(flow: AnyFlow): Analysis {
  const cached = cache.get(flow)
  if (cached !== undefined) return cached
  const problems: string[] = []
  const warnings: FlowWarning[] = []
  const nesting: NestingProblem[] = []
  const compiled = compileFlow(flow, { problems, warnings, nesting, path: [], chain: [flow] })
  if (problems.length > 0) {
    const worst = nesting[0]
    throw new WizardError(
      worst?.code ?? 'DEFINITION_INVALID',
      `flow '${describeName(flow)}' is invalid:\n- ${problems.join('\n- ')}`,
      {
        issues: problems.map((message) => ({ message })),
        ...(worst !== undefined ? { step: worst.step } : {}),
      },
    )
  }
  const analysis: Analysis = { compiled, warnings }
  cache.set(flow, analysis)
  return analysis
}
