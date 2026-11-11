import { boundary } from '../../src/authoring/boundary'
import type { HookArgs } from '../../src/authoring/compiled'
import type { AnyWizardDefinition } from '../../src/authoring/types'
import { WizardError } from '../../src/errors'

/** Explicit untyped boundary for definitions supplied by JavaScript callers. */
export function rawFlow(steps: unknown, extra: Record<string, unknown> = {}): AnyWizardDefinition {
  return {
    name: 'raw',
    context: boundary.trusted(),
    steps,
    ...extra,
  } as unknown as AnyWizardDefinition
}

export function rawStep(
  config: Record<string, unknown>,
  kind = 'step',
  child?: AnyWizardDefinition,
) {
  return { kind, config, ...(child === undefined ? {} : { child }) }
}

export function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof WizardError) return (error.issues ?? []).map((issue) => issue.message)
    throw error
  }
  throw new Error('expected a WizardError')
}

export function hookArgs(extra: Record<string, unknown> = {}): HookArgs {
  return {
    step: 's',
    path: [],
    context: {},
    deps: undefined,
    input: undefined,
    output: undefined,
    needs: {},
    signal: new AbortController().signal,
    attempt: 1,
    runId: 1,
    idempotencyKey: 'k',
    update: () => {},
    progress: () => {},
    ...extra,
  }
}
