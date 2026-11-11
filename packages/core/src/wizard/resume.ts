/**
 * Resume a run from a persisted snapshot (plan §8.8).
 *
 * 1. `validateSnapshot` — envelope, flow identity, step set, status
 *    invariants, JSON safety (recursively for children).
 * 2. Every boundary re-runs over the persisted data: `context`, view outputs
 *    (parsed inputs), run/flow outputs with an `output` boundary (and their
 *    copies on the compensation stack), inbox payloads. Parsed values replace
 *    the stored ones — this is what turns a persisted JSON form back into the
 *    rich value (`z.coerce.date()`), see `persistence/revivable.ts`.
 * 3. The whole tree is prepared *before* anything is instantiated (atomic): a
 *    `ResumePlan` per run, with the plans of its children. Nothing runs
 *    twice — the child factory consumes the prepared child plans as they are.
 * 4. `epoch + 1`, then the complete child tree is attached before `{ type: 'resume', fromSeq }`
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
 * §9.5: `opts.migrate(snapshot, from)` runs first when the snapshot names this
 * flow at a different version; its result is stamped with the current version and goes
 * through the same validation (a thenable result is a reason on the sync door, awaited on
 * the async one). Steps the definition added since the snapshot resume idle.
 *
 * @internal Public users call `wizard.resume` / `wizard.resumeAsync`.
 */

import type { CompiledFlow, RuntimeBoundary } from '../authoring/compiled'
import { describeError, WizardError } from '../errors'
import { isRecord } from '../record'
import { callSync, interpretResult, prepareResume } from './resume-prepare'
import {
  buildRuntime,
  type ResumePlan,
  type ResumeWizardRuntimeOptions,
  type RuntimeConfig,
  type SnapshotMigration,
  toConfig,
  type WizardRuntime,
} from './runtime'

export { type BoundaryParser, parseBoundarySync, prepareResume } from './resume-prepare'

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
 * §9.5: the snapshot's flow identity, when it has one. `migrate` runs only for a
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
    reasons.push(`migrate: returned a promise for ${from.name}@${from.version} (use resumeAsync)`)
    return input
  }
  return stampVersion(def, settled.value)
}

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
    return stampVersion(def, await migrate(input, from))
  } catch (error) {
    reasons.push(`migrate: threw (${describeError(error)})`)
    return input
  }
}

/**
 * A migrated snapshot is, by definition, a snapshot of the current version: stamp it so a
 * migration that only rewrites data (`renameSteps`) does not also have to rewrite `flow.version`.
 */
function stampVersion(def: CompiledFlow, migrated: unknown): unknown {
  if (!isRecord(migrated) || !isRecord(migrated.flow) || migrated.flow.name !== def.name)
    return migrated
  const flow = { name: def.name, version: def.version }
  const state = isRecord(migrated.state) ? { ...migrated.state, flow } : migrated.state
  return { ...migrated, flow, state }
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
  const runtime = buildRuntime(def, cfg, { state: plan.state, path, ancestors, persist: false })
  runtime.prepareResume(plan)
  return runtime
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
