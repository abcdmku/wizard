import type { AnyWizardDefinition, Run } from '@openwizard/core'

/** A run of any wizard. */
export type AnyRun = Run<AnyWizardDefinition>

interface SnapshotNode {
  readonly state: { readonly steps: Readonly<Record<string, StepRecord | undefined>> }
  readonly children: Readonly<Record<string, SnapshotNode | undefined>>
}

interface StepRecord {
  readonly kind?: string
  readonly status?: string
  readonly input?: unknown
  readonly error?: unknown
  readonly each?: { readonly keys: readonly string[] }
}

const isIndex = (value: string | undefined): value is string =>
  value !== undefined && /^(0|[1-9]\d*)$/.test(value)

/**
 * The run a wait entry belongs to. A path names child steps from the root, and a child that
 * runs once per item is followed by the index of the item: `['batch', '0']`.
 */
export function runAt(run: AnyRun, path: readonly string[]): AnyRun | undefined {
  let scope: AnyRun = run
  for (let position = 0; position < path.length; position++) {
    const step = path[position]
    if (step === undefined) return undefined
    const record = (scope.getState().steps as Record<string, StepRecord | undefined>)[step]
    const mapped = record?.kind === 'child' && record.each !== undefined
    const index = mapped ? path[++position] : undefined
    if (mapped && !isIndex(index)) return undefined
    try {
      const child = scope.child as (step: string, index?: number) => AnyRun
      scope = index === undefined ? child.call(scope, step) : child.call(scope, step, Number(index))
    } catch {
      return undefined
    }
  }
  return scope
}

/** The stored record of a step in the run at `path`. */
export function stepAt(run: AnyRun, path: readonly string[], step: string): StepRecord | undefined {
  const scope = runAt(run, path)
  return scope === undefined
    ? undefined
    : (scope.getState().steps as Record<string, StepRecord | undefined>)[step]
}

/** The path of a wait entry without item indexes, which is how `inspect` names a child step. */
export function manifestPath(run: AnyRun, path: readonly string[]): readonly string[] {
  const out: string[] = []
  let node = run.getSnapshot() as unknown as SnapshotNode | undefined
  for (let position = 0; position < path.length; position++) {
    const step = path[position]
    if (step === undefined) break
    out.push(step)
    const mapped = node?.state.steps[step]?.each !== undefined
    if (mapped) position += 1
    node = node?.children[step]
  }
  return out
}
