/**
 * `applyProjection(projection, state, def, children?)` — build the plain, JSON-safe projected
 * state for a projection. An `expose` projection is deny-by-default (only exposed inputs /
 * outputs / issues / errors / children / context keys / flow output / progress), errors
 * sanitised to `{ name, message, code?, data? }`, `phase` and `progress` from the machine
 * selectors; a `select` projection is its mapper over the (typed) state. `Run.project()`
 * and the Mirror frame producer call this.
 *
 * @internal Public users go through `run.project(projection)`.
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { AnyFlow } from '../authoring/types'
import { phase, progress } from '../machine'
import { eachItem } from '../machine/each-state'
import type { StepError, StepRecord, WizardState } from '../machine/state'
import { setOwn } from '../machine/util'
import { type WaitingFor, waitingFor } from '../machine/waiting-for'
import type { Snapshot } from '../wizard/snapshot'
import { projectionChild } from './child-definition'
import type { ClientStepError, Projection } from './define-projection'
import type { ProjectionDefinition } from './definition'
import { parseProjectionScope } from './scope'

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
  readonly waitingFor?: boolean
}

/** Child levels below the root that are projected precisely (mirrors the `ClientState` type). */
const MAX_DEPTH = 8

/**
 * Project a run state through a projection. `children` are the live child snapshots
 * (`runtime.getSnapshot().children`) used for exposed `child` specs.
 */
export function applyProjection<F extends AnyFlow, S, Scope = never>(
  projection: Projection<F, S, Scope> | Projection<ProjectionDefinition<F>, S, Scope>,
  state: WizardState,
  def: CompiledFlow,
  children: Readonly<Record<string, Snapshot>> = {},
  ...scopeArg: [Scope] extends [never] ? [] : [scope: Scope]
): S {
  const parsedScope = parseProjectionScope(
    projection,
    scopeArg.length > 0,
    scopeArg[0] as Scope | undefined,
  )
  const select = projection.select
  if (select !== undefined) {
    if (projection.scope === undefined) return (select as (state: WizardState) => S)(state)
    return (select as (input: { readonly state: WizardState; readonly scope: Scope }) => S)({
      state,
      scope: parsedScope as Scope,
    })
  }
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
  const indexed = indexedChildren(def, children, specs)
  for (const id of def.order) {
    const rec = Object.hasOwn(state.steps, id) ? state.steps[id] : undefined
    if (rec === undefined) continue
    const spec = specs !== undefined && Object.hasOwn(specs, id) ? specs[id] : undefined
    const child = Object.hasOwn(children, id) ? children[id] : undefined
    setOwn(steps, id, projectStep(rec, spec, def, state, child, indexed.get(id), depth))
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
    ...(expose?.waitingFor === true ? { waitingFor: projectedWaits(def, state, children) } : {}),
    steps,
  }
}

function indexedChildren(
  def: CompiledFlow,
  children: Readonly<Record<string, Snapshot>>,
  specs: RawExpose['steps'],
): ReadonlyMap<string, ReadonlyMap<number, Snapshot>> {
  const indexed = new Map<string, Map<number, Snapshot>>()
  if (
    specs === undefined ||
    !def.order.some(
      (id) =>
        def.steps[id]?.each !== undefined &&
        Object.hasOwn(specs, id) &&
        typeof specs[id]?.child === 'object',
    )
  )
    return indexed
  for (const [address, snapshot] of Object.entries(children)) {
    const child = projectionChild(def, address)
    if (
      child?.index === undefined ||
      !Object.hasOwn(specs, child.id) ||
      typeof specs[child.id]?.child !== 'object'
    )
      continue
    let items = indexed.get(child.id)
    if (items === undefined) {
      items = new Map()
      indexed.set(child.id, items)
    }
    items.set(child.index, snapshot)
  }
  return indexed
}

function projectedWaits(
  def: CompiledFlow,
  state: WizardState,
  children: Readonly<Record<string, Snapshot>>,
): readonly WaitingFor[] {
  const waits = [...waitingFor(def, state)]
  for (const id of state.active) {
    const child = Object.hasOwn(children, id) ? children[id] : undefined
    const childDef = def.steps[id]?.child
    if (child === undefined || childDef === undefined || def.steps[id]?.each !== undefined) continue
    for (const wait of projectedWaits(childDef, child.state, child.children)) {
      waits.push({ ...wait, path: [id, ...wait.path] })
    }
  }
  const active = new Set(state.active)
  for (const [address, child] of Object.entries(children)) {
    if (Object.hasOwn(def.steps, address)) continue
    const resolved = projectionChild(def, address)
    if (resolved === undefined || resolved.index === undefined || !active.has(resolved.id)) continue
    const each = state.steps[resolved.id]?.each
    if (each === undefined || eachItem(each, resolved.index).status !== 'running') continue
    for (const wait of projectedWaits(resolved.definition, child.state, child.children)) {
      waits.push({ ...wait, path: [...resolved.path, ...wait.path] })
    }
  }
  return waits
}

function projectStep(
  rec: StepRecord,
  expose: RawStepExpose | undefined,
  def: CompiledFlow,
  state: WizardState,
  childSnapshot: Snapshot | undefined,
  indexed: ReadonlyMap<number, Snapshot> | undefined,
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
  const childSpec = expose.child
  if (def.steps[rec.id]?.each !== undefined) {
    const each = rec.each
    if (each !== undefined) {
      out.child = each.items.map((_, index) => {
        if (childSpec === true) return eachItem(each, index).child ?? null
        const snapshot = indexed?.get(index)
        return snapshot === undefined
          ? null
          : project(childSpec, snapshot.state, childDef, snapshot.children, depth - 1)
      })
    }
    return out
  }
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
 * runnable step's `mapError` value (`data`, JSON-safe by contract) when present.
 */
function sanitizeError(error: StepError): ClientStepError<unknown> {
  return {
    name: error.name,
    message: error.message,
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.data === undefined ? {} : { data: error.data }),
  }
}
