/**
 * What the inspector shows for one step, read from a source snapshot: the stored record (wizard
 * — `steps[id]` of the root state or of a nested child snapshot) or the projected facts
 * (Mirror — `steps[id]` of the `ClientState`, nested through `child` slices), plus the
 * `explain()` result when the source is a wizard.
 *
 * @packageDocumentation
 */

import type { Explanation } from '@openwizard/core'
import {
  type DevtoolsSource,
  isProjectedState,
  isWizardSource,
  type ProjectedStep,
  type SnapshotLike,
  type WizardSource,
} from '../types'

/** A step as the inspector reads it. Either the wizard `record` or the Mirror `projected` facts is set. */
export interface StepReading {
  readonly id: string
  readonly path: readonly string[]
  /** `steps[id]` of the wizard state (untyped): status, attempt, input, output, error, timers, … */
  readonly record?: Readonly<Record<string, unknown>>
  /** `steps[id]` of the projected state (Mirror). */
  readonly projected?: ProjectedStep
  readonly explanation?: Explanation
  /** Why nothing could be read (unknown step, no frame yet, child not live). */
  readonly missing?: string
}

/** Read step `id` of the flow at `path` from `source` and its current `snapshot`. */
export function readStep(
  source: DevtoolsSource,
  snapshot: unknown,
  path: readonly string[],
  id: string,
): StepReading {
  return isWizardSource(source)
    ? readWizardStep(source, snapshot as SnapshotLike, path, id)
    : readProjectedStep(snapshot, path, id)
}

function readWizardStep(
  wizard: WizardSource,
  snapshot: SnapshotLike,
  path: readonly string[],
  id: string,
): StepReading {
  let node: SnapshotLike | undefined = snapshot
  let scope: WizardSource | undefined = wizard
  for (const step of path) {
    node = node?.children[step]
    try {
      scope = scope?.child(step)
    } catch {
      scope = undefined
    }
  }
  if (node === undefined)
    return { id, path, missing: `child flow at '${path.join('/')}' is not live` }
  const record = (node.state.steps as Readonly<Record<string, unknown>>)[id]
  if (typeof record !== 'object' || record === null)
    return { id, path, missing: `unknown step '${id}'` }
  const explanation = scope?.explain(id)
  return {
    id,
    path,
    record: record as Readonly<Record<string, unknown>>,
    ...(explanation === undefined ? {} : { explanation }),
  }
}

function readProjectedStep(snapshot: unknown, path: readonly string[], id: string): StepReading {
  if (!isProjectedState(snapshot)) return { id, path, missing: 'no projected state yet' }
  let state = snapshot
  for (const step of path) {
    const child: unknown = state.steps[step]?.child
    if (!isProjectedState(child)) {
      return {
        id,
        path,
        missing: `the projection does not expose the child flow at '${path.join('/')}'`,
      }
    }
    state = child
  }
  const projected = state.steps[id]
  return projected === undefined
    ? { id, path, missing: `unknown step '${id}'` }
    : { id, path, projected }
}
