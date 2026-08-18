/**
 * Live status overlay: flatten what a source knows about its steps — a wizard snapshot (state +
 * live children) or a projected `ClientState` (with nested `child` states) — into one
 * `StepStatusMap` keyed by `stepKey(path, id)`, plus the key of the current view.
 *
 * @packageDocumentation
 */

import {
  type DevtoolsSource,
  isProjectedState,
  isWizardSource,
  type ProjectedState,
  type SnapshotLike,
  type StepPhase,
  type StepStatusInfo,
  type StepStatusMap,
  stepKey,
  type WizardSource,
} from './types'

/** Mutable accumulator shared by the walkers. */
interface Collected {
  readonly statuses: Record<string, StepStatusInfo>
  current: string | null
}

/**
 * Flatten a wizard snapshot (`getSnapshot()`: state + children, recursively) or a projected
 * `ClientState` (its `steps`, recursing into `child` slices that are projected states) into a
 * `StepStatusMap`, and report the key of the current view (the deepest cursor). Phases come
 * from the projected state when it has them; for a wizard snapshot pass `phaseOf` (typically
 * `(path, id) => wizard.explain(id).phase` scoped to the child) to add them.
 * @public
 */
export function collectStatuses(
  state: SnapshotLike | ProjectedState,
  phaseOf?: (path: readonly string[], id: string) => StepPhase | undefined,
): { readonly statuses: StepStatusMap; readonly current: string | null } {
  const acc: Collected = { statuses: {}, current: null }
  if (isProjectedState(state)) walkProjected(state, [], acc)
  else walkSnapshot(state, [], acc, phaseOf)
  return acc
}

function walkSnapshot(
  snapshot: SnapshotLike,
  path: readonly string[],
  acc: Collected,
  phaseOf: ((path: readonly string[], id: string) => StepPhase | undefined) | undefined,
): void {
  const state = snapshot.state
  for (const id of Object.keys(state.steps)) {
    const record = state.steps[id]
    if (record === undefined) continue
    const phase = phaseOf?.(path, id)
    acc.statuses[stepKey(path, id)] =
      phase === undefined ? { status: record.status } : { status: record.status, phase }
  }
  if (state.current !== null) acc.current = stepKey(path, state.current)
  for (const id of Object.keys(snapshot.children)) {
    const child = snapshot.children[id]
    if (child !== undefined) walkSnapshot(child, [...path, id], acc, phaseOf)
  }
}

function walkProjected(state: ProjectedState, path: readonly string[], acc: Collected): void {
  for (const id of Object.keys(state.steps)) {
    const step = state.steps[id]
    if (step === undefined) continue
    acc.statuses[stepKey(path, id)] =
      step.phase === undefined
        ? { status: step.status }
        : { status: step.status, phase: step.phase }
    if (isProjectedState(step.child)) walkProjected(step.child, [...path, id], acc)
  }
  if (state.current !== null) acc.current = stepKey(path, state.current)
}

/**
 * The phase reader for a live wizard: `explain(id).phase` on the wizard for root steps and on
 * the live child handle for nested ones (a child that is not live has no phase).
 * @public
 */
export function wizardPhaseReader(
  wizard: WizardSource,
): (path: readonly string[], id: string) => StepPhase | undefined {
  return (path, id) => {
    let scope: WizardSource = wizard
    for (const step of path) {
      try {
        scope = scope.child(step)
      } catch {
        return undefined
      }
    }
    return scope.explain(id).phase
  }
}

/**
 * The live overlay of a source for one of its snapshots (`source.getSnapshot()`): statuses (with
 * phases) and the current view key — the wizard snapshot + `explain` for a wizard, the projected
 * state for a Mirror (a `select` projection that is not `ClientState`-shaped yields an empty map).
 * @public
 */
export function overlayOf(
  source: DevtoolsSource,
  snapshot: unknown,
): { readonly statuses: StepStatusMap; readonly current: string | null } {
  if (isWizardSource(source)) {
    return collectStatuses(snapshot as SnapshotLike, wizardPhaseReader(source))
  }
  return isProjectedState(snapshot) ? collectStatuses(snapshot) : { statuses: {}, current: null }
}
