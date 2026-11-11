/**
 * `compile(wizard)` — turns an inert `WizardDefinition` into the `CompiledWizard` the machine and the
 * interpreter consume, validating it on the way.
 *
 * Definition problems include unknown refs, dependency cycles, invalid option combinations,
 * step-level or wizard-level handler (`on`, `correlate`) for an undeclared event, fields a kind
 * does not accept (per-kind allow-lists, e.g. `input` on a plain step), malformed
 * hooks/policies. The error code is `NESTING_CYCLE` (a wizard embeds an ancestor) or
 * `NESTING_TOO_DEEP` (deeper than 8) when such a problem is among them, `DEFINITION_INVALID`
 * otherwise. Nested definition problems are collected together.
 *
 * `on` compiles for every kind. The machine applies the result contract: `keep` / `done` / `fail`
 * for `waitFor`, `{ next }` for views, `void` elsewhere, anything else `event.handlerResultIgnored`);
 * `when` → `hooks.when`; a runnable step's `idempotencyKey` → `idempotencyKey: true` (+ `hooks.idempotencyKey`
 * for the function form) and `mapError` → `hooks.mapError` (called with `(args.error, args)`);
 * the definition header's `on` / `correlate` → `def.on` / `def.correlate`.
 *
 * Warnings (never thrown; `analyze(wizard).warnings`, which `inspect()` reports):
 * `UNREACHABLE` (no path from `start` through `next`, `targets`, `needs`, `fallback` or
 * `timeout.next`), `NAV_CYCLE` (a cycle through static `next` / `timeout.next` edges —
 * allowed, reported).
 * Dynamic `next` functions require declared targets, which bound reachability analysis.
 *
 * Child step mappers (`context`, `deps`) are compiled RAW: the executor / child bridge parse
 * their values through the child's boundaries exactly once, at child creation.
 *
 * Results are cached per wizard object. Wizard assembly compiles eagerly.
 *
 * @packageDocumentation
 */

import { WizardError } from '../../errors'
import type { CompiledWizard } from '../compiled'
import type { AnyWizardDefinition } from '../types'
import { describeName } from './shared'
import { compileWizard, type NestingProblem } from './wizard'

/**
 * A static-analysis warning about a wizard (advisory; never thrown).
 * @public
 */
export interface ManifestWarning {
  readonly code:
    | 'UNREACHABLE'
    | 'NAV_CYCLE'
    | 'EXCLUSIVE_JOIN'
    | 'SKIPPED_NEED'
    | 'MULTIPLE_SINKS'
    | 'NO_SINKS'
  readonly message: string
  /** Step the warning is about. */
  readonly step?: string
  /** Run path of the wizard the step belongs to (`[]` = root). */
  readonly path: readonly string[]
}

/** @internal Cached result of analysing one wizard object. */
export interface Analysis {
  readonly compiled: CompiledWizard
  readonly warnings: readonly ManifestWarning[]
}

const cache = new WeakMap<object, Analysis>()

/**
 * Compile (and validate) a wizard. Throws `WizardError('DEFINITION_INVALID' | 'NESTING_CYCLE' |
 * 'NESTING_TOO_DEEP')` listing every problem. Cached per wizard object.
 * @internal
 */
export function compile(wizard: AnyWizardDefinition): CompiledWizard {
  return analyze(wizard).compiled
}

/** @internal Compile + warnings, cached per wizard object. */
export function analyze(wizard: AnyWizardDefinition): Analysis {
  const cached = cache.get(wizard)
  if (cached !== undefined) return cached
  const problems: string[] = []
  const warnings: ManifestWarning[] = []
  const nesting: NestingProblem[] = []
  const compiled = compileWizard(wizard, { problems, warnings, nesting, path: [], chain: [wizard] })
  if (problems.length > 0) {
    const worst = nesting[0]
    throw new WizardError(
      worst?.code ?? 'DEFINITION_INVALID',
      `wizard '${describeName(wizard)}' is invalid:\n- ${problems.join('\n- ')}`,
      {
        issues: problems.map((message) => ({ message })),
        ...(worst !== undefined ? { step: worst.step } : {}),
      },
    )
  }
  const analysis: Analysis = { compiled, warnings }
  cache.set(wizard, analysis)
  return analysis
}
