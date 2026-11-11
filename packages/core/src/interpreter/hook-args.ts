/**
 * `buildHookArgs` — the argument object every hook receives, built from the state, the step and
 * the effect's extras (extras override the base fields).
 *
 * @internal
 */

import type { CompiledFlow, HookArgs } from '../authoring/compiled'
import type { ContextUpdater } from '../machine/commands'
import type { WizardState } from '../machine/state'
import { setOwn } from '../machine/util'

interface BuildHookArgsInput {
  readonly def: CompiledFlow
  readonly path: readonly string[]
  readonly instanceId: string
  readonly deps: unknown
  readonly state: WizardState
  readonly step: string
  readonly signal: AbortSignal
  readonly update: (patch: Record<string, unknown> | ContextUpdater) => void
  /** The call's `progress(value)` sink; absent outside the effect pipeline (a no-op). */
  readonly progress?: (value: unknown) => void
  readonly extra?: Readonly<Record<string, unknown>> | undefined
}

const noProgress = (): void => {}

export function buildHookArgs(input: BuildHookArgsInput): HookArgs {
  const rec = input.state.steps[input.step]
  const runId = rec?.runId ?? 0
  const base = {
    step: input.step,
    path: input.path,
    context: input.state.context,
    deps: input.deps,
    input: rec?.input,
    output: rec?.output,
    needs: needsValues(input),
    signal: input.signal,
    attempt: rec?.attempt ?? 0,
    runId,
    // The run's stored key (custom `idempotencyKey` hook or default, set by `step.runStarted`), else the default.
    idempotencyKey: rec?.idempotencyKey ?? `${input.instanceId}:${input.step}:${runId}`,
    update: input.update,
    progress: input.progress ?? noProgress,
  }
  return input.extra === undefined ? base : { ...base, ...input.extra }
}

function needsValues(input: BuildHookArgsInput): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = {}
  for (const [alias, need] of Object.entries(input.def.steps[input.step]?.needs ?? {})) {
    let chosen: WizardState['steps'][string] | undefined
    for (const id of need.steps) {
      const producer = input.state.steps[id]
      if (producer?.status !== 'done') continue
      if (
        chosen === undefined ||
        (producer.completedSeq ?? Infinity) < (chosen.completedSeq ?? Infinity)
      )
        chosen = producer
    }
    setOwn(values, alias, chosen?.output)
  }
  return values
}
