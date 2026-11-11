/**
 * Live status overlay: flatten what a source knows about its steps — a run snapshot (state +
 * live children) or a projected `ClientState` (with nested `child` states) — into one
 * `StepStatusMap` keyed by `stepKey(path, id)`, plus the key of the current view.
 *
 * @packageDocumentation
 */

import type { StepStatus } from '@openwizard/core'
import { runAtPath, snapshotChildren } from './children'
import {
  type DevtoolsSource,
  isProjectedState,
  isRunSource,
  type ProjectedState,
  type RunSource,
  type SnapshotLike,
  type StepPhase,
  type StepStatusInfo,
  type StepStatusMap,
  stepKey,
} from './types'

/** Mutable accumulator shared by the walkers. */
interface Collected {
  readonly statuses: Record<string, StepStatusInfo>
  current: string | null
  readonly childPaths: string[][]
}

/**
 * Flatten a run snapshot (`getSnapshot()`: state + children, recursively) or a projected
 * `ClientState` (its `steps`, recursing into `child` slices that are projected states) into a
 * `StepStatusMap`, and report the key of the current view (the deepest cursor) and live
 * `childPaths` for the graph. Mapped children use `[owner, String(index)]`. Phases come
 * from the projected state when it has them; for a run snapshot pass `phaseOf` (typically
 * `(path, id) => run.explain(id).phase` scoped to the child) to add them.
 * @public
 */
export function collectStatuses(
  state: SnapshotLike | ProjectedState,
  phaseOf?: (path: readonly string[], id: string) => StepPhase | undefined,
): {
  readonly statuses: StepStatusMap
  readonly current: string | null
  readonly childPaths: readonly (readonly string[])[]
} {
  const acc: Collected = { statuses: {}, current: null, childPaths: [] }
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
  for (const child of snapshotChildren(snapshot)) {
    const childPath =
      child.index === undefined ? [...path, child.step] : [...path, child.step, String(child.index)]
    acc.childPaths.push(childPath)
    const status = childStatus(child.snapshot.state.status)
    if (child.index !== undefined && status !== undefined)
      acc.statuses[childPath.join('/')] = { status }
    walkSnapshot(child.snapshot, childPath, acc, phaseOf)
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
    if (isProjectedState(step.child)) {
      const childPath = [...path, id]
      acc.childPaths.push(childPath)
      walkProjected(step.child, childPath, acc)
    } else if (Array.isArray(step.child)) {
      for (let index = 0; index < step.child.length; index++) {
        const child: unknown = step.child[index]
        if (!isProjectedState(child)) continue
        const childPath = [...path, id, String(index)]
        acc.childPaths.push(childPath)
        const status = childStatus(child.status)
        if (status !== undefined) acc.statuses[childPath.join('/')] = { status }
        walkProjected(child, childPath, acc)
      }
    }
  }
  if (state.current !== null) acc.current = stepKey(path, state.current)
}

/**
 * The phase reader for a live run: `explain(id).phase` on the run for root steps and on
 * the live child handle for nested ones (a child that is not live has no phase).
 * @public
 */
export function runPhaseReader(
  run: RunSource,
): (path: readonly string[], id: string) => StepPhase | undefined {
  return (path, id) => runAtPath(run, path)?.explain(id).phase
}

function childStatus(status: string): StepStatus | undefined {
  switch (status) {
    case 'running':
    case 'waiting':
      return 'active'
    case 'halted':
      return 'failed'
    case 'idle':
    case 'done':
    case 'failed':
    case 'cancelled':
    case 'compensating':
      return status
    default:
      return undefined
  }
}

/**
 * The live overlay of a source for one of its snapshots (`source.getSnapshot()`): statuses (with
 * phases) and the current view key — the run snapshot + `explain` for a run, the projected
 * state for a Mirror (a `select` projection that is not `ClientState`-shaped yields an empty map).
 * @public
 */
export function overlayOf(
  source: DevtoolsSource,
  snapshot: unknown,
): {
  readonly statuses: StepStatusMap
  readonly current: string | null
  readonly childPaths: readonly (readonly string[])[]
} {
  if (isRunSource(source)) {
    return collectStatuses(snapshot as SnapshotLike, runPhaseReader(source))
  }
  return isProjectedState(snapshot)
    ? collectStatuses(snapshot)
    : { statuses: {}, current: null, childPaths: [] }
}
