/**
 * `buildHookArgs` — the argument object every hook receives, built from the state, the step and
 * the effect's extras (extras override the base fields).
 *
 * @internal
 */

import type { CompiledFlow, HookArgs } from '../authoring/compiled'
import type { WizardState } from '../machine/state'

export interface BuildHookArgsInput {
  readonly def: CompiledFlow
  readonly path: readonly string[]
  readonly instanceId: string
  readonly deps: unknown
  readonly state: WizardState
  readonly step: string
  readonly signal: AbortSignal
  readonly update: (patch: Record<string, unknown>) => void
  readonly extra?: Readonly<Record<string, unknown>> | undefined
}

export function buildHookArgs(input: BuildHookArgsInput): HookArgs {
  const rec = input.state.steps[input.step]
  const runId = rec?.runId ?? 0
  const base: HookArgs = {
    step: input.step,
    path: input.path,
    context: input.state.context,
    deps: input.deps,
    input: rec?.input,
    output: rec?.output,
    steps: input.state.steps,
    signal: input.signal,
    attempt: rec?.attempt ?? 0,
    runId,
    // The run's stored key (custom `idempotencyKey` hook or default, set by `step.runStarted`), else the default.
    idempotencyKey: rec?.idempotencyKey ?? `${input.instanceId}:${input.step}:${runId}`,
    update: input.update,
  }
  return input.extra === undefined ? base : { ...base, ...input.extra }
}
