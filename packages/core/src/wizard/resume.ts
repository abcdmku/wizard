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
 * @internal Public users see the typed `resumeWizard` / `resumeWizardAsync`.
 */

import type { BoundaryResult, CompiledFlow, RuntimeBoundary } from '../authoring/compiled'
import { WizardError } from '../errors'
import type { StepRecord } from '../machine/state'
import {
  buildRuntime,
  type ResumePlan,
  type ResumeWizardRuntimeOptions,
  type RuntimeConfig,
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
  input: unknown,
  opts: ResumeWizardRuntimeOptions,
): WizardRuntime {
  const cfg = toConfig(opts, restoreChild)
  const reasons: string[] = []
  const plan = prepareResume(def, input, '', reasons, parseBoundarySync)
  return instantiate(def, incompatibleUnless(def, plan, reasons), cfg, [], [], true)
}

/**
 * Async twin of `resumeWizardRuntime`: enumerate every boundary job with a dry
 * run, await them all, then prepare the plan from the settled results.
 */
export async function resumeWizardRuntimeAsync(
  def: CompiledFlow,
  input: unknown,
  opts: ResumeWizardRuntimeOptions,
): Promise<WizardRuntime> {
  const cfg = toConfig(opts, restoreChild)
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
  let result: unknown
  try {
    result = boundary.parse(value)
  } catch (error) {
    reasons.push(`${at}: boundary threw (${describeError(error)})`)
    return undefined
  }
  if (isThenableLike(result)) {
    reasons.push(
      `${at}: async boundaries are not supported by resumeWizard (use resumeWizardAsync)`,
    )
    return undefined
  }
  return interpretResult(at, result, reasons)
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
    if (rec.output !== undefined) {
      const boundary = stepDef.kind === 'view' ? stepDef.input : stepDef.output
      if (boundary !== undefined) {
        const parsed = run(`steps.${id}.output`, boundary, rec.output)
        if (parsed !== undefined) next = { ...rec, output: parsed.value }
      }
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

function isThenableLike(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function isIssueLike(value: unknown): value is { readonly message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
