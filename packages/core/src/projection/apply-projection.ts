/**
 * `applyProjection(projection, state, def, children?)` — build the plain, JSON-safe projected
 * state for a projection. An `expose` projection is deny-by-default (only exposed inputs /
 * outputs / issues / errors / children / context keys / flow output / progress), errors
 * sanitised to `{ name, message, code?, data? }`, `phase` and `progress` from the machine
 * selectors; a `select` projection is its mapper over the (typed) state. `Wizard.project()`
 * and the Mirror frame producer call this.
 *
 * @internal Public users go through `wizard.project(projection)`.
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { AnyFlow } from '../authoring/types'
import { phase, progress } from '../machine'
import type { StepError, StepRecord, WizardState } from '../machine/state'
import { setOwn } from '../machine/util'
import type { Snapshot } from '../wizard/snapshot'
import type { ClientStepError, Projection } from './define-projection'

/** Untyped exposure spec as read at runtime. */
interface RawStepExpose {
  readonly input?: boolean
  readonly output?: boolean
  readonly issues?: boolean
  readonly error?: boolean
  readonly child?: boolean | RawExpose
}
interface RawExpose {
  readonly steps?: Readonly<Record<string, RawStepExpose | undefined>>
  readonly context?: readonly string[]
  readonly output?: boolean
  readonly progress?: boolean
}

/** Child levels below the root that are projected precisely (mirrors the `ClientState` type). */
const MAX_DEPTH = 8

/**
 * Project a wizard state through a projection. `children` are the live child snapshots
 * (`runtime.getSnapshot().children`) used for exposed `child` specs.
 */
export function applyProjection<F extends AnyFlow, S>(
  projection: Projection<F, S>,
  state: WizardState,
  def: CompiledFlow,
  children: Readonly<Record<string, Snapshot>> = {},
): S {
  const select = projection.select as ((state: WizardState) => S) | undefined
  if (select !== undefined) return select(state)
  return project(projection.expose as RawExpose | undefined, state, def, children, MAX_DEPTH) as S
}

function project(
  expose: RawExpose | undefined,
  state: WizardState,
  def: CompiledFlow,
  children: Readonly<Record<string, Snapshot>>,
  depth: number,
): Record<string, unknown> {
  if (depth < 0) return { '~depth': 'exceeded' }
  const steps: Record<string, unknown> = {}
  const specs = expose?.steps
  for (const id of def.order) {
    const rec = Object.hasOwn(state.steps, id) ? state.steps[id] : undefined
    if (rec === undefined) continue
    const spec = specs !== undefined && Object.hasOwn(specs, id) ? specs[id] : undefined
    const child = Object.hasOwn(children, id) ? children[id] : undefined
    setOwn(steps, id, projectStep(rec, spec, def, state, child, depth))
  }
  return {
    instanceId: state.instanceId,
    epoch: state.epoch,
    seq: state.seq,
    status: state.status,
    current: state.current,
    context: pickContext(state.context, expose?.context),
    ...(expose?.output === true && state.output !== undefined ? { output: state.output } : {}),
    ...(expose?.progress === true ? { progress: progress(state, def) } : {}),
    steps,
  }
}

function projectStep(
  rec: StepRecord,
  expose: RawStepExpose | undefined,
  def: CompiledFlow,
  state: WizardState,
  childSnapshot: Snapshot | undefined,
  depth: number,
): Record<string, unknown> {
  const live = phase(def, state, rec.id)
  const out: Record<string, unknown> = {
    id: rec.id,
    kind: rec.kind,
    status: rec.status,
    ...(live !== undefined ? { phase: live } : {}),
    attempt: rec.attempt,
  }
  if (expose === undefined) return out
  if (expose.input === true && rec.input !== undefined) out.input = rec.input
  if (expose.output === true && rec.output !== undefined) out.output = rec.output
  if (expose.issues === true && rec.issues !== undefined) out.issues = rec.issues
  if (expose.error === true && rec.error !== undefined) out.error = sanitizeError(rec.error)
  const childDef = def.steps[rec.id]?.child
  if (childDef === undefined || expose.child === undefined || expose.child === false) return out
  if (expose.child === true) {
    if (rec.child !== undefined) out.child = rec.child
  } else if (childSnapshot !== undefined) {
    out.child = project(
      expose.child,
      childSnapshot.state,
      childDef,
      childSnapshot.children,
      depth - 1,
    )
  }
  return out
}

function pickContext(
  context: unknown,
  keys: readonly string[] | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (keys === undefined || typeof context !== 'object' || context === null) return out
  const source = context as Record<string, unknown>
  for (const key of keys) if (Object.hasOwn(source, key)) setOwn(out, key, source[key])
  return out
}

/**
 * Never leak stacks, hook internals or validation payloads: `{ name, message, code? }` plus the
 * task's `mapError` value (`data`, JSON-safe by contract) when present.
 */
function sanitizeError(error: StepError): ClientStepError<unknown> {
  return {
    name: error.name,
    message: error.message,
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.data === undefined ? {} : { data: error.data }),
  }
}
