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

import { compile } from '../authoring/compile'
import type { CompiledFlow, RuntimeBoundary } from '../authoring/compiled'
import type {
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  ContextInput,
  Ctx,
  DepsOf,
  DraftOf,
  ErrorOf,
  EventType,
  FlowOutput,
  Issue,
  KindOf,
  OutputOf,
  Progress,
  StepId,
  TaskId,
  ViewId,
} from '../authoring/types'
import { WizardError } from '../errors'
import type { Clock, IdGenerator, Scheduler } from '../interpreter/env'
import { initialState, type Explanation as MachineExplanation, machine } from '../machine'
import type { DomainEvent } from '../machine/events'
import type { StepError, StepRecord, WizardState } from '../machine/state'
import type { Store } from '../persistence/store'
import { applyProjection } from '../projection/apply-projection'
import type { Projection } from '../projection/define-projection'
import type { CommandResult, NavResult, SendResult } from './results'
import { resumeWizardRuntime, resumeWizardRuntimeAsync } from './resume'
import {
  createWizardRuntime,
  type ResumeWizardRuntimeOptions,
  type SnapshotMigration as RuntimeSnapshotMigration,
  type WizardRuntime,
  type WizardRuntimeOptions,
} from './runtime'
import type { Snapshot as RuntimeSnapshot } from './snapshot'

// ---------------------------------------------------------------------------
// Typed views over the runtime state
// ---------------------------------------------------------------------------

/**
 * A step's stored error typed by the step: `SerializedError` (`name`, `message`, `code?`) plus
 * `kind`, `at`, `attempt?`, `issues?` and — for a task with `mapError` — `data` (`ErrorOf<F, K>`).
 * @public
 */
export type StepErrorOf<F extends AnyFlow, K extends StepId<F>> = Omit<StepError, 'data'> & {
  readonly data?: ErrorOf<F, K>
}

/**
 * Typed view of one step's stored record: `input` is the draft (`DraftOf`), `output` the
 * step's `OutputOf`, `error` its `StepErrorOf` (with `data` for a `mapError` task); everything
 * else (status, attempt, guards, timers…) is shared.
 * @public
 */
export type StepState<F extends AnyFlow, K extends StepId<F>> = Omit<
  StepRecord,
  'id' | 'kind' | 'input' | 'output' | 'error'
> & {
  readonly id: K
  readonly kind: KindOf<F, K>
  readonly input?: DraftOf<F, K>
  readonly output?: OutputOf<F, K>
  readonly error?: StepErrorOf<F, K>
}

/** Typed view of `WizardState`. */
type StateOf<F extends AnyFlow> = Omit<
  WizardState,
  'current' | 'active' | 'context' | 'steps' | 'history' | 'failedStep' | 'output'
> & {
  readonly current: ViewId<F> | null
  readonly active: readonly StepId<F>[]
  readonly context: Ctx<F>
  readonly steps: { readonly [K in StepId<F>]: StepState<F, K> }
  readonly history: readonly ViewId<F>[]
  readonly failedStep?: StepId<F>
  readonly output?: FlowOutput<F>
}

/**
 * The versioned, JSON-safe snapshot of a wizard (what `getSnapshot()` returns, what a `Store`
 * persists and what `resumeWizard` accepts). `state` is the typed view of the wizard state;
 * `children` hold the snapshots of live child flows keyed by flow-step id.
 * @public
 */
export interface Snapshot<F extends AnyFlow> {
  readonly v: 1
  readonly flow: { readonly name: string; readonly version: number }
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  readonly savedAt: number
  readonly state: StateOf<F>
  readonly children: { readonly [K in ChildStepId<F>]?: Snapshot<ChildFlowOf<F, K>> }
}

type RetypeStep<T, F extends AnyFlow> = T extends { readonly step: string }
  ? Omit<T, 'step'> & { readonly step: StepId<F> }
  : 'step' extends keyof T
    ? Omit<T, 'step'> & { readonly step?: StepId<F> }
    : T
type RetypeEvent<T, F extends AnyFlow> = T extends { readonly event: string }
  ? Omit<T, 'event'> & { readonly event: EventType<F> }
  : T
type WithPath<T, P extends readonly string[]> = T extends unknown
  ? Omit<T, 'path'> & { readonly path: P }
  : never

/**
 * A domain event of the wizard's OWN flow (`path` is `[]`), typed by the flow: `step` is a
 * `StepId<F>`, `event` an `EventType<F>`.
 * @public
 */
export type RootWizardEvent<F extends AnyFlow = AnyFlow> = WithPath<
  RetypeEvent<RetypeStep<DomainEvent, F>, F>,
  readonly []
>

/**
 * A domain event forwarded from a child flow (`path.length > 0`, the child's wizard path): step
 * ids and event names are the child's, typed as `string`. Narrow with `isChildEvent(event)`.
 * @public
 */
export type ChildWizardEvent = WithPath<DomainEvent, readonly [string, ...string[]]>

/**
 * A domain event of a wizard (`observe()` / `log()`): either an event of its own flow, typed by
 * `F` (`RootWizardEvent<F>`, `path: []`), or one forwarded from a child flow
 * (`ChildWizardEvent`, `path: [step, …]`, ids as `string`). TypeScript does not narrow on
 * `event.path.length`; use `isChildEvent(event)` to split the two.
 * @public
 */
export type WizardEvent<F extends AnyFlow = AnyFlow> = RootWizardEvent<F> | ChildWizardEvent

/**
 * True for events forwarded from a child flow (`event.path.length > 0`); narrows a
 * `WizardEvent<F>` to `ChildWizardEvent` (and, in the other branch, to `RootWizardEvent<F>`).
 * @public
 */
export function isChildEvent(event: WizardEvent): event is ChildWizardEvent {
  return event.path.length > 0
}

/**
 * Result of `wizard.explain(step)`: the step's stored `status` (`'unknown'` for an unknown id),
 * its live `phase` (`undefined` when it has none), stable `reasons` codes explaining why it is
 * (not) where you expect (`flow-not-started`, `nav-busy`, `not-activated`, `deps-unmet:<id>`,
 * `guard-false:canEnter`, `concurrency-limit`, `auto-run-manual`, `failed:<kind>`,
 * `not-current`, `entering`, `retrying`, …) and the ready views the cursor could move to.
 * @public
 */
export type Explanation<F extends AnyFlow = AnyFlow> = Omit<MachineExplanation, 'candidates'> & {
  readonly candidates: readonly ViewId<F>[]
}

/** Depth budget for typed child commands: `Prev[D]` = one child level deeper; `Prev[0]` = `never` = beyond. */
type CommandDepthPrev = [never, 0, 1, 2, 3, 4, 5, 6, 7]

/**
 * A `child` command with `string` ids: what typed child commands widen to for a wildcard flow
 * (`AnyFlow`) or beyond the depth budget.
 * @public
 */
export interface AnyChildCommand {
  readonly type: 'child'
  readonly path: readonly [string, ...string[]]
  readonly command: Command<AnyFlow>
}

/**
 * `setInput` correlated per view: `step: K` with `patch: DraftOf<F, K>`.
 * @public
 */
export type SetInputCommand<F extends AnyFlow> = {
  [K in ViewId<F>]: { readonly type: 'setInput'; readonly step: K; readonly patch: DraftOf<F, K> }
}[ViewId<F>]

/**
 * A command addressed to a nested flow: `path: [flowStep]` with a `Command` of that child, or a
 * longer path (`[flowStep, grandChildStep, …]`) whose `command` is typed for the flow at its end
 * — the flattened form of nesting `child` commands. For a wildcard flow or beyond the depth
 * budget (8 child levels) it is `AnyChildCommand` (ids widen to `string`).
 * @public
 */
export type ChildCommand<F extends AnyFlow, Depth extends number = 8> = [Depth] extends [never]
  ? AnyChildCommand
  : string extends ChildStepId<F>
    ? AnyChildCommand
    : {
        [K in ChildStepId<F>]:
          | {
              readonly type: 'child'
              readonly path: readonly [K]
              readonly command: Command<ChildFlowOf<F, K>, CommandDepthPrev[Depth]>
            }
          | (ChildCommand<ChildFlowOf<F, K>, CommandDepthPrev[Depth]> extends infer Inner
              ? Inner extends {
                  readonly path: infer P extends readonly string[]
                  readonly command: infer C
                }
                ? {
                    readonly type: 'child'
                    readonly path: readonly [K, ...P]
                    readonly command: C
                  }
                : never
              : never)
      }[ChildStepId<F>]

/**
 * A wire command (JSON), typed by the flow: `go` / `setInput` / `resetInput` take a `ViewId<F>`
 * (`setInput.patch` is that view's `DraftOf`), `run` / `retry` a `TaskId<F>`, `send` an
 * `EventType<F>` (its `payload` stays `unknown` — it is re-parsed by the event boundary),
 * `compensate.from` / `skip.step` / `invalidate.step` a `StepId<F>`, and `child` a typed
 * `ChildCommand<F>`. `Depth` bounds the child recursion (8 child levels; beyond it ids widen to
 * `string`). Untrusted input becomes a `Command<F>` through `parseCommand(flow, input)`;
 * `Command<AnyFlow>` is the untyped shape.
 * @public
 */
export type Command<F extends AnyFlow = AnyFlow, Depth extends number = 8> =
  | { readonly type: 'start' }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'go'; readonly step: ViewId<F>; readonly reason?: string }
  | SetInputCommand<F>
  | { readonly type: 'resetInput'; readonly step: ViewId<F> }
  | {
      readonly type: 'send'
      readonly event: EventType<F>
      readonly payload: unknown
      readonly correlationId?: string
    }
  | { readonly type: 'run'; readonly step: TaskId<F> }
  | { readonly type: 'runReady' }
  | { readonly type: 'retry'; readonly step: TaskId<F> }
  | { readonly type: 'cancel'; readonly reason?: string }
  | { readonly type: 'compensate'; readonly from?: StepId<F>; readonly reason?: string }
  | { readonly type: 'reset' }
  | { readonly type: 'skip'; readonly step: StepId<F>; readonly reason?: string }
  | { readonly type: 'invalidate'; readonly step: StepId<F>; readonly cascade?: boolean }
  | ChildCommand<F, Depth>

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

/**
 * A live wizard instance, typed by its flow. Navigation returns `NavResult`, everything else a
 * `CommandResult` / `SendResult`; nothing throws for data problems.
 * @public
 */
export interface Wizard<F extends AnyFlow> {
  /** Instance id (also the default store key). */
  readonly id: string
  /** Increments on every resume. */
  readonly epoch: number
  /** The flow this wizard runs. */
  readonly flow: F
  /** Activate the `start` step(s). */
  start(): Promise<CommandResult>
  next(): Promise<NavResult>
  back(): Promise<NavResult>
  go(step: ViewId<F>): Promise<NavResult>
  /** Shallow-merge a draft patch into a view's input (parsed on `next`/`go`). */
  setInput<K extends ViewId<F>>(step: K, patch: DraftOf<F, K>): Promise<CommandResult>
  resetInput(step: ViewId<F>): Promise<CommandResult>
  /** Pure query: the view's `input` boundary + `validate` hook over the current draft. */
  validate(step: ViewId<F>): Promise<readonly Issue[]>
  /** External event through the flow's event boundary (payload is untrusted). */
  send<E extends EventType<F>>(
    event: E,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<SendResult>
  /** Run one ready task now (`autoRun: 'manual'`, or a task waiting on `dependsOn`). */
  run(step: TaskId<F>): Promise<CommandResult>
  /** Re-run a failed task (`attempt` resets). */
  retry(step: TaskId<F>): Promise<CommandResult>
  cancel(reason?: string): Promise<CommandResult>
  /** Start ready non-view steps when `autoRun: 'manual'`. */
  runReady(): Promise<CommandResult>
  compensate(options?: {
    readonly from?: StepId<F>
    readonly reason?: string
  }): Promise<CommandResult>
  /** Back to the initial state (`flow.reset`): steps idle, timers cleared, children disposed; the instance id stays. */
  reset(): Promise<CommandResult>
  /**
   * Skip a ready-or-active non-final step explicitly (`step.skipped { reason: 'command' }`): it
   * counts as done for `dependsOn` and its `next` targets are arrived; an active task is
   * cancelled first; a view must be ready or current (the current view exits without validation).
   */
  skip(step: StepId<F>, reason?: string): Promise<CommandResult>
  /**
   * Return a `done` / `failed` / `skipped` step to `idle` (`step.invalidated`): a view keeps its
   * draft, the output moves to `previousOutput`, and with `cascade` (default `true`) every
   * transitive `dependsOn` dependent that is done / failed / skipped follows (running ones are
   * cancelled). Never automatic; rejected for an active step or the current view (`INVALID_COMMAND`).
   */
  invalidate(step: StepId<F>, options?: { readonly cascade?: boolean }): Promise<CommandResult>
  /**
   * The one wire door, typed by the flow (`Command<F>`); never throws for data problems.
   * Untrusted input (a request body) goes through `parseCommand(flow, input)` first.
   */
  dispatch(command: Command<F>): Promise<CommandResult>
  /**
   * Hook an external event source (a queue consumer, an `EventTarget`, a socket) to `send`:
   * `source` receives the wizard's typed `send` and returns its own teardown, which runs when
   * the returned function is called or when the wizard is disposed.
   */
  attach(source: (send: Wizard<F>['send']) => () => void): () => void
  getState(): Snapshot<F>['state']
  /** Versioned, JSON-safe snapshot including live children; cached per state. */
  getSnapshot(): Snapshot<F>
  /**
   * Pure query: why a step is (not) where you expect — status, live phase, stable reason codes
   * and the ready views the cursor could move to. Never throws (an unknown id yields
   * `status: 'unknown'`); safe to call after `dispose()`.
   */
  explain(step: StepId<F>): Explanation<F>
  /** Pure query: `{ done, total, ratio }` over the non-final steps (`skipped` counts as done). */
  progress(): Progress
  /** Pure query: the views that are ready or current (where the cursor is or could go). */
  readyViews(): readonly ViewId<F>[]
  /** State listeners: once per committed batch. */
  subscribe(listener: (state: Snapshot<F>['state']) => void): () => void
  /** Event listeners: every event of this wizard and its children (`event.path`). */
  observe(listener: (event: WizardEvent<F>) => void): () => void
  /** Bounded event ring (default 200). */
  log(): readonly WizardEvent<F>[]
  /** Live nested wizard of a `flow` step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`). */
  child<K extends ChildStepId<F>>(step: K): Wizard<ChildFlowOf<F, K>>
  /**
   * Client-safe state through a projection defined for THIS flow object — a deny-by-default
   * `expose` projection (`ClientState<F, E>`) or a `select` projection (its return type)
   * (`WizardError('DEFINITION_INVALID')` for a projection of any other flow, same name or not).
   */
  project<S>(projection: Projection<F, S>): S
  /** Write a snapshot now (no-op without a store). */
  save(): Promise<void>
  dispose(): void
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type DepsOption<F extends AnyFlow> =
  unknown extends DepsOf<F> ? { readonly deps?: DepsOf<F> } : { readonly deps: DepsOf<F> }

/**
 * `createWizard` options: the context input (parsed by the flow's context boundary), `deps`
 * (required iff the flow declares a deps boundary), persistence and injectables.
 * @public
 */
export type WizardOptions<F extends AnyFlow> = {
  readonly context: ContextInput<F>
  readonly instanceId?: string
  /**
   * Correlation id of this instance (`defineFlow({ correlate })`): a delivered event whose
   * extracted id differs is dropped (`event.dropped { reason: 'correlation' }`). Persisted in the
   * snapshot (`state.correlationId`), so resume needs no option.
   */
  readonly correlationId?: string
  readonly store?: Store
  /** Store key; defaults to the instance id. */
  readonly key?: string
  /** Default `'change'` when a store is given. */
  readonly autoSave?: 'change' | 'off'
  /** Coalesce auto-saves (ms). Default 0 = write after each drain that changed state. */
  readonly debounceMs?: number
  /** Applied to the snapshot right before `store.set`. */
  readonly redact?: (snapshot: Snapshot<F>) => unknown
  /**
   * Called when an auto-save cannot be written: the store rejected, or the snapshot is not
   * JSON-serializable (`WizardError('SNAPSHOT_NOT_SERIALIZABLE')` naming the exact path, e.g.
   * `state.steps.save.output.createdAt`). The same failure is also logged as a `persist.failed`
   * event. Default: rethrown asynchronously (an uncaught error).
   */
  readonly onPersistError?: (error: unknown) => void
  readonly clock?: Clock
  readonly scheduler?: Scheduler
  readonly ids?: IdGenerator
  /** Turn the first thenable returned by a hook into a `SYNC_VIOLATION` failure. */
  readonly strict?: 'sync'
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number
} & DepsOption<F>

/**
 * Snapshot migration (`resumeWizard(flow, snapshot, { migrate })`): called with the raw
 * snapshot when its `flow.version` differs from the flow's, and the flow identity (`from`);
 * returns the converted snapshot, which is validated like any other (its `flow.version` must
 * equal the flow's, else `SNAPSHOT_INCOMPATIBLE`). `flow.name` must always match. May return
 * a promise — then only `resumeWizardAsync` accepts it.
 * @public
 */
export type SnapshotMigration = RuntimeSnapshotMigration

/** The options shared by creation and resume (persistence, injectables, deps). */
type SharedOptions<F extends AnyFlow> = Omit<
  WizardOptions<F>,
  'context' | 'instanceId' | 'correlationId'
>

/**
 * `resumeWizard` options: `WizardOptions` without `context` / `instanceId` / `correlationId`
 * (they come from the snapshot), plus `migrate` for snapshots of an older flow `version`.
 * @public
 */
export type ResumeOptions<F extends AnyFlow> = SharedOptions<F> & {
  readonly migrate?: SnapshotMigration
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Boundary parsing at the door
// ---------------------------------------------------------------------------

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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

// ---------------------------------------------------------------------------
// Wrapping the runtime
// ---------------------------------------------------------------------------

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
