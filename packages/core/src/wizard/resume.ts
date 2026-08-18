/**
 * Resume a wizard from a persisted snapshot (plan §8.8).
 *
 * 1. `validateSnapshot` — envelope, flow identity, step set, status
 *    invariants, JSON safety (recursively for children).
 * 2. Every boundary re-runs over the persisted data: `context`, view outputs
 *    (parsed inputs), task/flow outputs with an `output` boundary (and their
 *    copies on the compensation stack), inbox payloads. Parsed values replace
 *    the stored ones — this is what turns a persisted JSON form back into the
 *    rich value (`z.coerce.date()`), see `persistence/revivable.ts`.
 * 3. The whole tree is prepared *before* anything is instantiated (atomic): a
 *    `ResumePlan` per wizard, with the plans of its children. Nothing runs
 *    twice — the child factory consumes the prepared child plans as they are.
 * 4. `epoch + 1`, then the interpreter receives `{ type: 'resume', fromSeq }`
 *    (the machine applies the recovery matrix) and children are re-attached.
 *    An active `flow` step whose child snapshot is missing has its child
 *    summary stripped so the machine re-creates the child through the normal
 *    `childContext` → `child.started` → `child.create` pipeline.
 *
 * Any failure → `WizardError('SNAPSHOT_INCOMPATIBLE')` whose `issues` list one
 * reason per problem. `resumeWizardRuntime` (sync) reports an asynchronous
 * boundary as a reason pointing to `resumeWizardRuntimeAsync`, which awaits
 * every boundary of the whole tree first and only then instantiates (still
 * atomic; the boundary jobs are enumerated by a dry run of the same preparation).
 *
 * v0.2 (§9.5): `opts.migrate(snapshot, from)` runs first when the snapshot names this
 * flow at a different version; its result goes through the same validation (a
 * thenable result is a reason on the sync door, awaited on the async one).
 *
 * @internal Public users see the typed `resumeWizard` / `resumeWizardAsync`.
 */

import type { BoundaryResult, CompiledFlow, RuntimeBoundary } from '../authoring/compiled'
import { describeError, WizardError } from '../errors'
import { getThen, type Then } from '../interpreter/thenable'
import type { StepRecord } from '../machine/state'
import {
  buildRuntime,
  type ResumePlan,
  type ResumeWizardRuntimeOptions,
  type RuntimeConfig,
  type SnapshotMigration,
  toConfig,
  type WizardRuntime,
} from './runtime'
import { validateSnapshot } from './snapshot'

/**
 * How `prepareResume` runs one boundary: `at` is the full location label
 * (`children.f.steps.x.output`), the result is the parsed value or `undefined`
 * after pushing a reason.
 */
export type BoundaryParser = (
  at: string,
  boundary: RuntimeBoundary,
  value: unknown,
  reasons: string[],
) => { readonly value: unknown } | undefined

export function resumeWizardRuntime(
  def: CompiledFlow,
  rawInput: unknown,
  opts: ResumeWizardRuntimeOptions,
): WizardRuntime {
  const cfg = toConfig(opts, restoreChild)
  const reasons: string[] = []
  const input = migrateSync(def, rawInput, opts.migrate, reasons)
  const plan = reasons.length > 0 ? undefined : prepareResume(def, input, '', reasons)
  return instantiate(def, incompatibleUnless(def, plan, reasons), cfg, [], [], true)
}

/**
 * Async twin of `resumeWizardRuntime`: enumerate every boundary job with a dry
 * run, await them all, then prepare the plan from the settled results.
 */
export async function resumeWizardRuntimeAsync(
  def: CompiledFlow,
  rawInput: unknown,
  opts: ResumeWizardRuntimeOptions,
): Promise<WizardRuntime> {
  const cfg = toConfig(opts, restoreChild)
  const migrated: string[] = []
  const input = await migrateAsync(def, rawInput, opts.migrate, migrated)
  if (migrated.length > 0) incompatibleUnless(def, undefined, migrated)
  const jobs: Array<{
    readonly at: string
    readonly boundary: RuntimeBoundary
    readonly value: unknown
  }> = []
  prepareResume(def, input, '', [], (at, boundary, value) => {
    jobs.push({ at, boundary, value })
    return { value }
  })
  const settled = new Map<string, Settled>()
  await Promise.all(
    jobs.map(async (job) => {
      try {
        settled.set(job.at, { result: await job.boundary.parse(job.value) })
      } catch (error) {
        settled.set(job.at, { threw: error })
      }
    }),
  )
  const reasons: string[] = []
  const plan = prepareResume(def, input, '', reasons, (at, _boundary, _value, out) => {
    const entry = settled.get(at)
    if (entry === undefined) {
      out.push(`${at}: boundary was not evaluated`)
      return undefined
    }
    if ('threw' in entry) {
      out.push(`${at}: boundary threw (${describeError(entry.threw)})`)
      return undefined
    }
    return interpretResult(at, entry.result, out)
  })
  return instantiate(def, incompatibleUnless(def, plan, reasons), cfg, [], [], true)
}

type Settled = { readonly result: unknown } | { readonly threw: unknown }

/**
 * v0.2 (§9.5): the snapshot's flow identity, when it has one. `migrate` runs only for a
 * same-name, different-version snapshot; anything else is left for `validateSnapshot` to judge.
 */
function migrationNeeded(
  def: CompiledFlow,
  input: unknown,
): { readonly name: string; readonly version: number } | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const flow = (input as { readonly flow?: unknown }).flow
  if (typeof flow !== 'object' || flow === null) return undefined
  const { name, version } = flow as { readonly name?: unknown; readonly version?: unknown }
  if (typeof name !== 'string' || typeof version !== 'number') return undefined
  return name === def.name && version !== def.version ? { name, version } : undefined
}

/**
 * Run `migrate` synchronously; a thenable result or a throw is a reason (async → use the async
 * door). The `then` accessor is read inside the same guard as the call (a hostile thenable is a
 * reason, never an escaping exception) and an abandoned promise gets a rejection sink so it can
 * never surface as an unhandled rejection.
 */
function migrateSync(
  def: CompiledFlow,
  input: unknown,
  migrate: SnapshotMigration | undefined,
  reasons: string[],
): unknown {
  const from = migrationNeeded(def, input)
  if (from === undefined || migrate === undefined) return input
  const settled = callSync(() => migrate(input, from), 'migrate:', reasons)
  if (settled === undefined) return input
  if (settled.async) {
    reasons.push(
      `migrate: returned a promise for ${from.name}@${from.version} (use resumeWizardAsync)`,
    )
    return input
  }
  return settled.value
}

/**
 * Call `fn` at the sync door: `{ value }` for a plain result, `{ async: true }` for a thenable
 * (silenced with a rejection sink), `undefined` after pushing a reason when `fn` — or the
 * thenable's `then` accessor — throws.
 */
function callSync(
  fn: () => unknown,
  what: string,
  reasons: string[],
): { readonly value: unknown; readonly async?: false } | { readonly async: true } | undefined {
  let value: unknown
  let then: Then | undefined
  try {
    value = fn()
    then = getThen(value)
  } catch (error) {
    reasons.push(`${what} threw (${describeError(error)})`)
    return undefined
  }
  if (then === undefined) return { value }
  try {
    then.call(value, noop, noop)
  } catch {
    // The sink is best-effort: a `then` that throws has nothing left to reject.
  }
  return { async: true }
}

function noop(): void {}

/** Await `migrate` (sync or async); a throw / rejection is a reason. */
async function migrateAsync(
  def: CompiledFlow,
  input: unknown,
  migrate: SnapshotMigration | undefined,
  reasons: string[],
): Promise<unknown> {
  const from = migrationNeeded(def, input)
  if (from === undefined || migrate === undefined) return input
  try {
    return await migrate(input, from)
  } catch (error) {
    reasons.push(`migrate: threw (${describeError(error)})`)
    return input
  }
}

function incompatibleUnless(
  def: CompiledFlow,
  plan: ResumePlan | undefined,
  reasons: string[],
): ResumePlan {
  if (plan === undefined || reasons.length > 0) {
    throw new WizardError(
      'SNAPSHOT_INCOMPATIBLE',
      `snapshot is not compatible with flow '${def.name}@${def.version}': ${reasons.join('; ')}`,
      { issues: reasons.map((message) => ({ message })) },
    )
  }
  return plan
}

/** Child factory hook (see `RuntimeConfig.restore`): the plan was prepared with the root's. */
function restoreChild(
  def: CompiledFlow,
  plan: ResumePlan,
  cfg: RuntimeConfig,
  path: readonly string[],
  ancestors: readonly object[],
): WizardRuntime {
  return instantiate(def, plan, cfg, path, ancestors, false)
}

function instantiate(
  def: CompiledFlow,
  plan: ResumePlan,
  cfg: RuntimeConfig,
  path: readonly string[],
  ancestors: readonly object[],
  persist: boolean,
): WizardRuntime {
  const runtime = buildRuntime(def, cfg, { state: plan.state, path, ancestors, persist })
  runtime.resumeFrom(plan)
  return runtime
}

/** The synchronous parser: a thenable result is a reason (use the async variant). */
export const parseBoundarySync: BoundaryParser = (at, boundary, value, reasons) => {
  const settled = callSync(() => boundary.parse(value), `${at}: boundary`, reasons)
  if (settled === undefined) return undefined
  if (settled.async) {
    reasons.push(
      `${at}: async boundaries are not supported by resumeWizard (use resumeWizardAsync)`,
    )
    return undefined
  }
  return interpretResult(at, settled.value, reasons)
}

function interpretResult(
  at: string,
  result: unknown,
  reasons: string[],
): { readonly value: unknown } | undefined {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    const r = result as BoundaryResult
    if (r.ok) return { value: r.value }
    const issues = Array.isArray(r.issues) ? r.issues : []
    const detail = issues.map((i: unknown) => (isIssueLike(i) ? i.message : String(i))).join(', ')
    reasons.push(`${at}: rejected by boundary${detail.length > 0 ? ` (${detail})` : ''}`)
    return undefined
  }
  reasons.push(`${at}: boundary returned an invalid result`)
  return undefined
}

/**
 * Structure + boundaries for one wizard and, recursively, its children;
 * collects human-readable reasons instead of throwing. Exported for tests;
 * `resumeWizardRuntime` / `resumeWizardRuntimeAsync` are the production callers.
 */
export function prepareResume(
  def: CompiledFlow,
  input: unknown,
  prefix: string,
  reasons: string[],
  parse: BoundaryParser = parseBoundarySync,
): ResumePlan | undefined {
  const validation = validateSnapshot(def, input)
  if (!validation.ok) {
    for (const r of validation.reasons) reasons.push(prefix + r)
    return undefined
  }
  const snapshot = validation.snapshot
  const state = snapshot.state
  const run = (at: string, boundary: RuntimeBoundary, value: unknown) =>
    parse(prefix + at, boundary, value, reasons)

  const context = run('context', def.context, state.context)

  const children: Record<string, ResumePlan> = Object.create(null)
  for (const [step, child] of Object.entries(snapshot.children)) {
    const childDef = def.steps[step]?.child
    if (childDef === undefined) continue
    const childPlan = prepareResume(childDef, child, `${prefix}children.${step}.`, reasons, parse)
    if (childPlan !== undefined) children[step] = childPlan
  }

  const steps: Record<string, StepRecord> = Object.create(null)
  for (const id of def.order) {
    const rec = state.steps[id]
    const stepDef = def.steps[id]
    if (rec === undefined || stepDef === undefined) continue
    let next = rec
    const boundary = stepDef.kind === 'view' ? stepDef.input : stepDef.output
    if (rec.output !== undefined && boundary !== undefined) {
      const parsed = run(`steps.${id}.output`, boundary, rec.output)
      if (parsed !== undefined) next = { ...next, output: parsed.value }
    }
    // v0.2: the output moved aside by `invalidate` is revived by the same boundary.
    if (rec.previousOutput !== undefined && boundary !== undefined) {
      const parsed = run(`steps.${id}.previousOutput`, boundary, rec.previousOutput)
      if (parsed !== undefined) next = { ...next, previousOutput: parsed.value }
    }
    // Missing child snapshot for a live flow step: forget the summary so `plan(flow.resumed)`
    // re-creates the child through `childContext` (plan §8.8: "missing → child re-created").
    if (
      stepDef.kind === 'flow' &&
      rec.status === 'active' &&
      rec.child !== undefined &&
      children[id] === undefined
    ) {
      const { child: _dropped, ...rest } = next
      next = rest
    }
    steps[id] = next
  }

  const inbox = state.inbox.map((entry, i) => {
    const boundary = Object.hasOwn(def.events, entry.event) ? def.events[entry.event] : undefined
    if (boundary === undefined) return entry
    const parsed = run(`inbox[${i}].payload`, boundary, entry.payload)
    return parsed === undefined ? entry : { ...entry, payload: parsed.value }
  })

  // The compensation stack keeps a copy of each completed step's output (what its `compensate`
  // hook receives): re-parse it through the same boundary as the step's record.
  const stack = state.saga.stack.map((entry, i) => {
    if (entry.output === undefined) return entry
    const stepDef = Object.hasOwn(def.steps, entry.step) ? def.steps[entry.step] : undefined
    const boundary = stepDef?.kind === 'view' ? stepDef.input : stepDef?.output
    if (boundary === undefined) return entry
    const parsed = run(`saga.stack[${i}].output`, boundary, entry.output)
    return parsed === undefined ? entry : { ...entry, output: parsed.value }
  })

  if (context === undefined) return undefined
  return {
    snapshot,
    state: {
      ...state,
      context: context.value,
      steps,
      inbox,
      saga: { ...state.saga, stack },
      epoch: state.epoch + 1,
    },
    children,
  }
}

function isIssueLike(value: unknown): value is { readonly message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
}
