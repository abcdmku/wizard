/**
 * The run constructors behind `wizard.create`, `wizard.createAsync`, `wizard.resume`,
 * `wizard.resumeAsync`, `wizard.run` and `wizard.runSync`, and the `Run<F>` interface. They
 * are internal: `defineWizard` binds them to the wizard, and applications call the wizard's
 * methods.
 *
 * Each constructor compiles the flow (cached per flow object), pushes `context` (and `deps`,
 * when the flow declares a deps boundary) through their boundaries, and hands the untyped
 * `WizardRuntime` the pure machine. Every `Run` method is sugar over `dispatch(command)`, typed
 * by the flow (`Command<F>`). Untrusted input goes through `parseCommand(flow, unknown)` first.
 * Results are values. `WizardError` is thrown only for programmer errors (see the runtime).
 *
 * @packageDocumentation
 */

import { compile } from '../../authoring/compile'
import type { CompiledFlow, RuntimeBoundary } from '../../authoring/compiled'
import type { AnyFlow } from '../../authoring/types'
import { WizardError } from '../../errors'
import { isThenable } from '../../interpreter/thenable'
import { initialState, machine } from '../../machine'
import type { RunOutcome } from '../results'
import { resumeWizardRuntime, resumeWizardRuntimeAsync } from '../resume'
import {
  createWizardRuntime,
  type ResumeWizardRuntimeOptions,
  type WizardRuntime,
  type WizardRuntimeOptions,
} from '../runtime'
import { outcomeSync } from '../runtime/outcome'
import type { ResumeOptions, Run, RunOptions, SharedOptions } from './wizard'
import { typedOutcome, wrap } from './wrap'

export type {
  CompensationFailure,
  CompensationSummary,
  FlowFailure,
  RunCancelled,
  RunDone,
  RunFailed,
  RunHalted,
  RunLifecycleCode,
  RunOutcome,
  RunResult,
  RunWaiting,
  StepFailure,
  WaitingFor,
} from '../results'
export { RunLifecycleError } from '../results'
export type { DispatchOptions, SendOptions } from '../runtime/types'
export type { AnyChildCommand, ChildCommand, Command, SetInputCommand } from './command'
export {
  type ChildRunEvent,
  type Explanation,
  isChildEvent,
  type RootRunEvent,
  type RunEvent,
  type RunEventType,
  type Snapshot,
  type StepErrorOf,
  type StepState,
} from './state'
export type { ResumeOptions, Run, RunOptions, SnapshotMigration } from './wizard'

/**
 * Behind `wizard.create`: parses `context` (and `deps`) through the flow's boundaries
 * synchronously, compiles the flow and builds a runtime. `start()` activates the entry steps.
 */
export function createRun<F extends AnyFlow>(flow: F, options: RunOptions<F>): Run<F> {
  const def = compile(flow)
  return wrap(createRuntime(def, options), flow, def)
}

/** Behind `wizard.createAsync`: like `createRun`, awaiting the context / deps boundaries. */
export async function createRunAsync<F extends AnyFlow>(
  flow: F,
  options: RunOptions<F>,
): Promise<Run<F>> {
  const def = compile(flow)
  const creation = prepareCreate(def, options)
  const context = await parseAsync(def.context, creation.context, 'context')
  const deps =
    def.deps === undefined ? creation.deps : await parseAsync(def.deps, creation.deps, 'deps')
  return wrap(creation.runtime(context, deps), flow, def)
}

/**
 * Behind `wizard.run`: create, start, wait for the next outcome that needs the outside world
 * (`awaitOutcome`), dispose.
 */
export async function runToOutcome<F extends AnyFlow>(
  flow: F,
  options: RunOptions<F>,
): Promise<RunOutcome<F>> {
  const run = await createRunAsync(flow, options)
  try {
    await run.start()
    return await run.awaitOutcome()
  } finally {
    run.dispose()
  }
}

/**
 * Behind `wizard.runSync`: the same outcome, computed synchronously under `strict: 'sync'`;
 * throws `SYNC_VIOLATION` naming the step when a hook returns a promise or a timer is needed.
 */
export function runToOutcomeSync<F extends AnyFlow>(
  flow: F,
  options: RunOptions<F>,
): RunOutcome<F> {
  const runtime = createRuntime(compile(flow), { ...options, strict: 'sync' })
  try {
    // start commits synchronous work before returning its command promise.
    void runtime.start()
    return typedOutcome<F>(outcomeSync(runtime))
  } finally {
    runtime.dispose()
  }
}

/**
 * Behind `wizard.resume`: the envelope, flow identity, step set and every boundary are
 * re-validated (`WizardError('SNAPSHOT_INCOMPATIBLE')` lists every reason); `epoch` increments;
 * interrupted work follows the recovery matrix. A snapshot of another flow `version` goes
 * through `options.migrate` first (else `SNAPSHOT_INCOMPATIBLE`).
 */
export function resumeRun<F extends AnyFlow>(
  flow: F,
  snapshot: unknown,
  options: ResumeOptions<F>,
): Run<F> {
  const def = compile(flow)
  const resumption = prepareResume(def, options)
  const deps =
    def.deps === undefined ? resumption.deps : parseSync(def.deps, resumption.deps, 'deps')
  return wrap(resumeWizardRuntime(def, snapshot, resumption.options(deps)), flow, def)
}

/**
 * Behind `wizard.resumeAsync`: like `resumeRun`, for asynchronous boundaries (context, deps,
 * view inputs, run / flow outputs, event payloads). Every boundary is awaited BEFORE any runtime
 * is constructed, so resume stays atomic (`SNAPSHOT_INCOMPATIBLE` lists every reason, nothing
 * runs on failure).
 */
export async function resumeRunAsync<F extends AnyFlow>(
  flow: F,
  snapshot: unknown,
  options: ResumeOptions<F>,
): Promise<Run<F>> {
  const def = compile(flow)
  const resumption = prepareResume(def, options)
  const deps =
    def.deps === undefined ? resumption.deps : await parseAsync(def.deps, resumption.deps, 'deps')
  const runtime = await resumeWizardRuntimeAsync(def, snapshot, resumption.options(deps))
  return wrap(runtime, flow, def)
}

/** The runtime of a new run: `context` / `deps` through their synchronous boundaries. */
function createRuntime<F extends AnyFlow>(
  def: CompiledFlow,
  options: RunOptions<F>,
): WizardRuntime {
  const creation = prepareCreate(def, options)
  const context = parseSync(def.context, creation.context, 'context')
  const deps = def.deps === undefined ? creation.deps : parseSync(def.deps, creation.deps, 'deps')
  return creation.runtime(context, deps)
}

/**
 * What creating a run needs besides its boundaries' verdicts: the raw `context`, `deps` merged
 * with the definition's providers, and the runtime built from both once they are parsed. The
 * sync and async constructors differ only in how they parse.
 */
function prepareCreate<F extends AnyFlow>(def: CompiledFlow, options: RunOptions<F>) {
  const shared = runtimeOptions(options)
  const { context, deps, instanceId, correlationId } = options
  return {
    context,
    deps: mergeDeps(def, deps, 'deps' in options),
    runtime: (context: unknown, deps: unknown): WizardRuntime =>
      createWizardRuntime(def, {
        ...shared,
        instanceId,
        correlationId,
        context,
        deps,
      } as WizardRuntimeOptions),
  }
}

/** The resume counterpart of `prepareCreate`: merged `deps` and the options built from them. */
function prepareResume<F extends AnyFlow>(def: CompiledFlow, options: ResumeOptions<F>) {
  const shared = runtimeOptions(options)
  const { deps, migrate } = options
  return {
    deps: mergeDeps(def, deps, 'deps' in options),
    options: (deps: unknown) => ({ ...shared, migrate, deps }) as ResumeWizardRuntimeOptions,
  }
}

/** Snapshot every shared public option once, including inherited and non-enumerable values. */
function runtimeOptions<F extends AnyFlow>(options: SharedOptions<F>) {
  const out: Record<string, unknown> = { machine, initialState }
  for (const key of [
    'store',
    'key',
    'autoSave',
    'debounceMs',
    'redact',
    'onPersistError',
    'clock',
    'scheduler',
    'ids',
    'beforeEffects',
    'beforeTimer',
    'strict',
    'logSize',
    'eventIds',
    'onListenerError',
  ] as const)
    out[key] = options[key]
  return out
}

/** Parse a synchronous context or dependency boundary. */
function parseSync(boundary: RuntimeBoundary, value: unknown, what: 'context' | 'deps'): unknown {
  const result = boundary.parse(value)
  if (isThenable(result)) {
    throw new WizardError(
      'DEFINITION_INVALID',
      `${what} boundary must be synchronous for create()/resume(); use createAsync()/resumeAsync()`,
    )
  }
  return unwrap(result, what)
}

async function parseAsync(
  boundary: RuntimeBoundary,
  value: unknown,
  what: 'context' | 'deps',
): Promise<unknown> {
  return unwrap(await boundary.parse(value), what)
}

function unwrap(result: Awaited<ReturnType<RuntimeBoundary['parse']>>, what: string): unknown {
  if (result.ok) return result.value
  throw new WizardError(
    'BOUNDARY_REJECTED',
    `${what} rejected by its boundary: ${result.issues.map((i) => i.message).join('; ')}`,
    { issues: result.issues },
  )
}

/** Providers are carried by the definition, including internal and adapter-created runs. */
function mergeDeps(def: CompiledFlow, deps: unknown, supplied: boolean): unknown {
  if (!supplied && deps === undefined && def.deps !== undefined) deps = {}
  return def.providedDeps === undefined
    ? deps
    : { ...def.providedDeps, ...(deps as object | undefined) }
}
