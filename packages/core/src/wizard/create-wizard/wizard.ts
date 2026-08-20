/**
 * The `FlowRun<F>` interface (the typed façade over the runtime) and its creation / resume options.
 * @packageDocumentation
 */

import type {
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  ContextInput,
  DepsOf,
  DraftOf,
  EventType,
  Issue,
  Progress,
  StepId,
  TaskId,
  ViewId,
} from '../../authoring/types'
import type { Clock, IdGenerator, Scheduler } from '../../interpreter/env'
import type { Store } from '../../persistence/store'
import type { Projection } from '../../projection/define-projection'
import type { CommandResult, NavResult, RunResult, SendResult } from '../results'
import type { SnapshotMigration as RuntimeSnapshotMigration } from '../runtime'
import type { Command } from './command'
import type { Explanation, RunEvent, Snapshot } from './state'

/**
 * A live run instance, typed by its flow. Navigation returns `NavResult`, everything else a
 * `CommandResult` / `SendResult`; nothing throws for data problems.
 * @public
 */
export interface FlowRun<F extends AnyFlow> {
  /** Instance id (also the default store key). */
  readonly id: string
  /** Increments on every resume. */
  readonly epoch: number
  /** The flow definition this instance runs. */
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
   * `source` receives the run's typed `send` and returns its own teardown, which runs when
   * the returned function is called or when the run is disposed.
   */
  attach(source: (send: FlowRun<F>['send']) => () => void): () => void
  getState(): Snapshot<F>['state']
  /** The terminal result, or `undefined` while the run is not terminal. */
  result(): RunResult<F> | undefined
  /** Wait for the terminal result; reset/dispose rejects with `RunLifecycleError`. */
  awaitResult(): Promise<RunResult<F>>
  /** Subscribe to terminal transitions; a reset starts a new subscription cycle. */
  subscribeResult(listener: (result: RunResult<F>) => void): () => void
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
  /** Event listeners: every event of this run and its children (`event.path`). */
  observe(listener: (event: RunEvent<F>) => void): () => void
  /** Bounded event ring (default 200). */
  log(): readonly RunEvent<F>[]
  /** Live nested run of a `flow` step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`). */
  child<K extends ChildStepId<F>>(step: K): FlowRun<ChildFlowOf<F, K>>
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

type DepsOption<F extends AnyFlow> =
  unknown extends DepsOf<F> ? { readonly deps?: DepsOf<F> } : { readonly deps: DepsOf<F> }

/**
 * `createRun` options: the context input (parsed by the flow's context boundary), `deps`
 * (required iff the flow declares a deps boundary), persistence and injectables.
 * @public
 */
export type RunOptions<F extends AnyFlow> = {
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
  /**
   * Optional host barrier. It runs after the next state swap and before the transition is
   * published or any planned task, child, or timer effect runs. Throwing or rejecting aborts the
   * runtime; normal runs leave it unset.
   */
  readonly beforeEffects?: (input: {
    readonly snapshot: Snapshot<F>
    readonly events: readonly RunEvent<F>[]
  }) => void | Promise<void>
  /** Optional host gate that must claim a timer before its fire message is enqueued. */
  readonly beforeTimer?: (timer: {
    readonly timerId: string
    readonly dueAt: number
    readonly expected: { readonly epoch: number; readonly seq: number }
  }) => boolean | Promise<boolean>
  /** Turn the first thenable returned by a hook into a `SYNC_VIOLATION` failure. */
  readonly strict?: 'sync'
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number
} & DepsOption<F>

/**
 * Snapshot migration (`resumeRun(flow, snapshot, { migrate })`): called with the raw
 * snapshot when its `flow.version` differs from the flow's, and the flow identity (`from`);
 * returns the converted snapshot, which is validated like any other (its `flow.version` must
 * equal the flow's, else `SNAPSHOT_INCOMPATIBLE`). `flow.name` must always match. May return
 * a promise — then only `resumeRunAsync` accepts it.
 * @public
 */
export type SnapshotMigration = RuntimeSnapshotMigration

/** The options shared by creation and resume (persistence, injectables, deps). */
export type SharedOptions<F extends AnyFlow> = Omit<
  RunOptions<F>,
  'context' | 'instanceId' | 'correlationId'
>

/**
 * `resumeRun` options: `RunOptions` without `context` / `instanceId` / `correlationId`
 * (they come from the snapshot), plus `migrate` for snapshots of an older flow `version`.
 * @public
 */
export type ResumeOptions<F extends AnyFlow> = SharedOptions<F> & {
  readonly migrate?: SnapshotMigration
}
