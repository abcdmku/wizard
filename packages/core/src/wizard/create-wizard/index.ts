/**
 * Typed façade: `createWizard(flow, options)` / `createWizardAsync` / `resumeWizard` /
 * `resumeWizardAsync` and the `Wizard<F>` interface — thin, typed wrappers over the untyped
 * `WizardRuntime`.
 *
 * The façade compiles the flow (cached per flow object), pushes `context` (and `deps`, when the
 * flow declares a deps boundary) through their boundaries, and hands the runtime the pure
 * machine. Every method is sugar over `dispatch(command)` — typed by the flow (`Command<F>`);
 * untrusted input goes through `parseCommand(flow, unknown)` first. Results are values,
 * `WizardError` is thrown only for programmer errors (see the runtime).
 *
 * @packageDocumentation
 */

import { compile } from '../../authoring/compile'
import type { CompiledFlow, RuntimeBoundary } from '../../authoring/compiled'
import type { AnyFlow, ChildFlowOf, ViewId } from '../../authoring/types'
import { WizardError } from '../../errors'
import { isThenable } from '../../interpreter/thenable'
import { initialState, machine } from '../../machine'
import type { DomainEvent } from '../../machine/events'
import type { WizardState } from '../../machine/state'
import { applyProjection } from '../../projection/apply-projection'
import { resumeWizardRuntime, resumeWizardRuntimeAsync } from '../resume'
import {
  createWizardRuntime,
  type ResumeWizardRuntimeOptions,
  type WizardRuntime,
  type WizardRuntimeOptions,
} from '../runtime'
import type { Snapshot as RuntimeSnapshot } from '../snapshot'
import type { Explanation, Snapshot, WizardEvent } from './state'
import type { ResumeOptions, SharedOptions, Wizard, WizardOptions } from './wizard'

export type { AnyChildCommand, ChildCommand, Command, SetInputCommand } from './command'
export {
  type ChildWizardEvent,
  type Explanation,
  isChildEvent,
  type RootWizardEvent,
  type Snapshot,
  type StepErrorOf,
  type StepState,
  type WizardEvent,
} from './state'
export type { ResumeOptions, SnapshotMigration, Wizard, WizardOptions } from './wizard'

/**
 * Create a wizard from a flow: parses `context` (and `deps`) through the flow's boundaries
 * synchronously (async boundaries → use `createWizardAsync`), compiles the flow and starts a
 * runtime. Call `start()` to activate the entry step(s).
 * @public
 */
export function createWizard<F extends AnyFlow>(flow: F, options: WizardOptions<F>): Wizard<F> {
  const def = compile(flow)
  const context = parseSync(def.context, options.context, 'context')
  const deps = def.deps === undefined ? options.deps : parseSync(def.deps, options.deps, 'deps')
  const runtime = createWizardRuntime(def, {
    ...runtimeOptions(options),
    ...createOptions(options),
    context,
    ...(deps !== undefined ? { deps } : {}),
  })
  return wrap(runtime, flow, def)
}

/**
 * Like `createWizard`, for flows whose context / deps boundaries are asynchronous.
 * @public
 */
export async function createWizardAsync<F extends AnyFlow>(
  flow: F,
  options: WizardOptions<F>,
): Promise<Wizard<F>> {
  const def = compile(flow)
  const context = await parseAsync(def.context, options.context, 'context')
  const deps =
    def.deps === undefined ? options.deps : await parseAsync(def.deps, options.deps, 'deps')
  const runtime = createWizardRuntime(def, {
    ...runtimeOptions(options),
    ...createOptions(options),
    context,
    ...(deps !== undefined ? { deps } : {}),
  })
  return wrap(runtime, flow, def)
}

/**
 * Resume a wizard from a persisted snapshot: the envelope, flow identity, step set and every
 * boundary are re-validated (`WizardError('SNAPSHOT_INCOMPATIBLE')` lists every reason);
 * `epoch` increments; interrupted work follows the recovery matrix. A snapshot of another flow
 * `version` goes through `options.migrate` first (else `SNAPSHOT_INCOMPATIBLE`).
 * @public
 */
export function resumeWizard<F extends AnyFlow>(
  flow: F,
  snapshot: unknown,
  options: ResumeOptions<F>,
): Wizard<F> {
  const def = compile(flow)
  const deps = def.deps === undefined ? options.deps : parseSync(def.deps, options.deps, 'deps')
  const runtime = resumeWizardRuntime(def, snapshot, {
    ...runtimeOptions(options),
    ...resumeOnlyOptions(options),
    ...(deps !== undefined ? { deps } : {}),
  })
  return wrap(runtime, flow, def)
}

/**
 * Like `resumeWizard`, for flows with asynchronous boundaries (context, deps, view inputs, task
 * / flow outputs, event payloads): every boundary is awaited BEFORE any runtime is constructed,
 * so resume stays atomic (`SNAPSHOT_INCOMPATIBLE` lists every reason, nothing runs on failure).
 * @public
 */
export async function resumeWizardAsync<F extends AnyFlow>(
  flow: F,
  snapshot: unknown,
  options: ResumeOptions<F>,
): Promise<Wizard<F>> {
  const def = compile(flow)
  const deps =
    def.deps === undefined ? options.deps : await parseAsync(def.deps, options.deps, 'deps')
  const runtime = await resumeWizardRuntimeAsync(def, snapshot, {
    ...runtimeOptions(options),
    ...resumeOnlyOptions(options),
    ...(deps !== undefined ? { deps } : {}),
  })
  return wrap(runtime, flow, def)
}

/** Options that only exist at creation (`instanceId`, `correlationId` → `state.correlationId`). */
function createOptions<F extends AnyFlow>(
  options: WizardOptions<F>,
): Pick<WizardRuntimeOptions, 'instanceId' | 'correlationId'> {
  return {
    ...(options.instanceId !== undefined ? { instanceId: options.instanceId } : {}),
    ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
  }
}

/** Options that only exist on resume (`migrate`). */
function resumeOnlyOptions<F extends AnyFlow>(
  options: ResumeOptions<F>,
): Pick<ResumeWizardRuntimeOptions, 'migrate'> {
  return options.migrate !== undefined ? { migrate: options.migrate } : {}
}

function runtimeOptions<F extends AnyFlow>(
  options: SharedOptions<F>,
): Omit<WizardRuntimeOptions, 'context' | 'deps' | 'instanceId' | 'correlationId'> {
  return {
    machine,
    initialState,
    ...(options.store !== undefined ? { store: options.store } : {}),
    ...(options.key !== undefined ? { key: options.key } : {}),
    ...(options.autoSave !== undefined ? { autoSave: options.autoSave } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.redact !== undefined
      ? { redact: options.redact as (snapshot: RuntimeSnapshot) => unknown }
      : {}),
    ...(options.onPersistError !== undefined ? { onPersistError: options.onPersistError } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.scheduler !== undefined ? { scheduler: options.scheduler } : {}),
    ...(options.ids !== undefined ? { ids: options.ids } : {}),
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
    ...(options.logSize !== undefined ? { logSize: options.logSize } : {}),
  }
}

function parseSync(boundary: RuntimeBoundary, value: unknown, what: 'context' | 'deps'): unknown {
  const result = boundary.parse(value)
  if (isThenable(result)) {
    throw new WizardError(
      'DEFINITION_INVALID',
      `${what} boundary must be synchronous for createWizard/resumeWizard; use createWizardAsync/resumeWizardAsync`,
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

const wrappers = new WeakMap<WizardRuntime, Wizard<AnyFlow>>()

function wrap<F extends AnyFlow>(runtime: WizardRuntime, flow: F, def: CompiledFlow): Wizard<F> {
  const existing = wrappers.get(runtime)
  if (existing !== undefined) return existing as unknown as Wizard<F>
  const wizard: Wizard<F> = {
    id: runtime.id,
    get epoch() {
      return runtime.epoch
    },
    flow,
    start: () => runtime.start(),
    next: () => runtime.next(),
    back: () => runtime.back(),
    go: (step) => runtime.go(step),
    setInput: (step, patch) => runtime.setInput(step, patch),
    resetInput: (step) => runtime.resetInput(step),
    validate: (step) => runtime.validate(step),
    send: (event, payload, options) => runtime.send(event, payload, options),
    run: (step) => runtime.run(step),
    retry: (step) => runtime.retry(step),
    cancel: (reason) => runtime.cancel(reason),
    runReady: () => runtime.runReady(),
    compensate: (options) => runtime.compensate(options),
    reset: () => runtime.reset(),
    skip: (step, reason) => runtime.skip(step, reason),
    invalidate: (step, options) => runtime.invalidate(step, options),
    dispatch: (command) => runtime.dispatch(command),
    attach: (source) => runtime.attach(source),
    getState: () => runtime.getState() as Snapshot<F>['state'],
    getSnapshot: () => runtime.getSnapshot() as unknown as Snapshot<F>,
    explain: (step) => runtime.explain(step) as Explanation<F>,
    progress: () => runtime.progress(),
    readyViews: () => runtime.readyViews() as readonly ViewId<F>[],
    subscribe: (listener) => runtime.subscribe(listener as (state: WizardState) => void),
    observe: (listener) => runtime.observe(listener as (event: DomainEvent) => void),
    log: () => runtime.log() as readonly WizardEvent<F>[],
    child: (step) => {
      const childRuntime = runtime.child(step)
      const childDef = def.steps[step]?.child
      const childFlow = (flow.steps as Record<string, { readonly child?: AnyFlow }>)[step]?.child
      if (childDef === undefined || childFlow === undefined) {
        throw new WizardError('NOT_A_FLOW_STEP', `'${step}' is not a flow step`, { step })
      }
      return wrap(childRuntime, childFlow, childDef) as Wizard<ChildFlowOf<F, typeof step>>
    },
    project: (projection) => {
      // Identity, not name: a same-name, same-shape flow is type-compatible but not this flow.
      if (projection.flow !== flow) {
        throw new WizardError(
          'DEFINITION_INVALID',
          `projection was defined for flow '${projection.flow.name}' (a different flow object), not for this wizard's flow '${def.name}'`,
        )
      }
      return applyProjection(projection, runtime.getState(), def, runtime.getSnapshot().children)
    },
    save: () => runtime.save(),
    dispose: () => runtime.dispose(),
  }
  wrappers.set(runtime, wizard as unknown as Wizard<AnyFlow>)
  return wizard
}
