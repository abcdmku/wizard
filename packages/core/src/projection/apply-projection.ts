/**
 * `applyProjection(projection, state, def, children?)` — build the plain, JSON-safe
 * `ClientState` object for a projection: deny-by-default (only exposed inputs / outputs /
 * issues / errors / children / context keys / flow output), errors sanitised to
 * `{ name, message, code? }`, `phase` from the machine selectors. `Wizard.project()` and the
 * Mirror frame producer call this.
 *
 * @internal Public users go through `wizard.project(projection)`.
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { AnyFlow } from '../authoring/types'
import { phase } from '../machine'
import type { SerializedError, StepRecord, WizardState } from '../machine/state'
import type { Snapshot } from '../wizard/snapshot'
import type { ClientState, Projection } from './define-projection'

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
}

/** Child levels below the root that are projected precisely (mirrors the `ClientState` type). */
const MAX_DEPTH = 8

/**
 * Project a wizard state through a projection. `children` are the live child snapshots
 * (`runtime.getSnapshot().children`) used for exposed `child` specs.
 */
export function applyProjection<F extends AnyFlow, E>(
  projection: Projection<F, E>,
  state: WizardState,
  def: CompiledFlow,
  children: Readonly<Record<string, Snapshot>> = {},
): ClientState<F, E> {
  return project(
    projection.expose as RawExpose | undefined,
    state,
    def,
    children,
    MAX_DEPTH,
  ) as ClientState<F, E>
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

/** Own-property write even for `__proto__` (a plain assignment would change the prototype). */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  } else {
    target[key] = value
  }
}

/** Never leak stacks, hook internals or validation payloads: `{ name, message, code? }` only. */
function sanitizeError(error: SerializedError): SerializedError {
  return error.code === undefined
    ? { name: error.name, message: error.message }
    : { name: error.name, message: error.message, code: error.code }
}
