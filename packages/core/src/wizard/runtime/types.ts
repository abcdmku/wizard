/**
 * Types of the untyped wizard runtime: creation / resume options, the `WizardRuntime` surface
 * (what the typed `Wizard<F>` façade wraps) and the internal config / plan shapes shared by a
 * root, its resume path and its children.
 *
 * @internal Public users see the typed `Wizard<F>`.
 */

import type { CompiledFlow } from '../../authoring/compiled'
import type { Clock, IdGenerator, RuntimeEnv, Scheduler } from '../../interpreter/env'
import type { Explanation, Progress } from '../../machine'
import type { Command } from '../../machine/commands'
import type { DomainEvent } from '../../machine/events'
import type { Issue, WizardState } from '../../machine/state'
import type { InitialState, Machine } from '../../machine/types'
import type { Store } from '../../persistence/store'
import type { CommandResult, NavResult, SendResult } from '../results'
import type { Snapshot } from '../snapshot'

export interface WizardRuntimeOptions {
  /** Context value that already passed the flow's context boundary. */
  readonly context: unknown
  /** Injected dependencies (already through `def.deps`, if declared); `args.deps` in hooks. */
  readonly deps?: unknown
  readonly instanceId?: string
  /** The pure machine (`decide/apply/plan`) and its initial-state builder. */
  readonly machine: Machine
  readonly initialState: InitialState
  readonly store?: Store
  /** Store key; defaults to the instance id. */
  readonly key?: string
  /** Default `'change'` when a store is given. */
  readonly autoSave?: 'change' | 'off'
  /** Coalesce auto-saves (ms). Default 0 = write after each drain that changed state. */
  readonly debounceMs?: number
  /** Applied to the snapshot right before `store.set`. */
  readonly redact?: (snapshot: Snapshot) => unknown
  /** Delete the key instead of writing once the flow is `done`. */
  readonly clearOnDone?: boolean
  /** Store failures on the auto-save path. Default: rethrown asynchronously. */
  readonly onPersistError?: (error: unknown) => void
  readonly clock?: Clock
  /** A `TestScheduler` passed here without `clock` is used as the clock too. */
  readonly scheduler?: Scheduler
  readonly ids?: IdGenerator
  /** Turn the first thenable returned by a hook into a `SYNC_VIOLATION` failure. */
  readonly strict?: 'sync'
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number
  /** Grace period before an aborted, unsettled hook is reported (ms). Default 30 s. */
  readonly abortGraceMs?: number
  /** Listener exceptions are isolated; default rethrows asynchronously. */
  readonly onListenerError?: (error: unknown) => void
  /**
   * v0.2 (§9.1): correlation id of this instance. An event whose `correlate[event](payload)`
   * differs from it is dropped (`event.dropped { reason: 'correlation' }`). Stored in the state
   * (persisted with the snapshot); children created by this instance inherit it.
   */
  readonly correlationId?: string
}

/**
 * v0.2 (§9.5): rewrite a snapshot persisted by an older flow version. Called only when the
 * snapshot's `flow.version` differs from the flow's (a `flow.name` mismatch is always
 * incompatible); the result is validated like any snapshot and must carry the flow's version.
 * May return a promise — then only `resumeWizardAsync` accepts it.
 */
export type SnapshotMigration = (
  snapshot: unknown,
  from: { readonly name: string; readonly version: number },
) => unknown

export type ResumeWizardRuntimeOptions = Omit<
  WizardRuntimeOptions,
  'context' | 'instanceId' | 'correlationId'
> & {
  readonly migrate?: SnapshotMigration
}

export interface WizardRuntime {
  readonly id: string
  readonly path: readonly string[]
  /** Increments on every resume; Mirrors use `(epoch, seq)` to order frames. */
  readonly epoch: number
  start(): Promise<CommandResult>
  next(): Promise<NavResult>
  back(): Promise<NavResult>
  go(step: string): Promise<NavResult>
  setInput(step: string, patch: unknown): Promise<CommandResult>
  resetInput(step: string): Promise<CommandResult>
  /** Pure query: the view's `input` boundary + `validate` hook over the current draft; no events. */
  validate(step: string): Promise<readonly Issue[]>
  /** External event through the flow's event boundary. Unknown event name → `WizardError('UNKNOWN_EVENT')`. */
  send(
    event: string,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<SendResult>
  run(step: string): Promise<CommandResult>
  retry(step: string): Promise<CommandResult>
  cancel(reason?: string): Promise<CommandResult>
  runReady(): Promise<CommandResult>
  compensate(options?: { readonly from?: string; readonly reason?: string }): Promise<CommandResult>
  reset(): Promise<CommandResult>
  /** v0.2 (§9.2): skip a ready-or-active non-final step (`step.skipped { reason: 'command' }`). */
  skip(step: string, reason?: string): Promise<CommandResult>
  /** v0.2 (§9.3): a done/failed/skipped step returns to idle; `cascade` (default true) follows `dependsOn` dependents. */
  invalidate(step: string, options?: { readonly cascade?: boolean }): Promise<CommandResult>
  /**
   * v0.2 (§9.1): connect an external event source: `source(send)` subscribes and returns a
   * disposer, which runs on `dispose()` (or when the returned function is called). Throws `DISPOSED`.
   */
  attach(source: (send: WizardRuntime['send']) => () => void): () => void
  /** v0.2 (§9.6): `{ done, total, ratio }` over the non-final steps (skipped counts as done). */
  progress(): Progress
  /** v0.2 (§9.6): the current view plus every ready view, in declaration order. */
  readyViews(): readonly string[]
  /** The one wire door: validates the shape (`decodeCommand`) and never throws for data problems. */
  dispatch(command: Command): Promise<CommandResult>
  getState(): WizardState
  /** Versioned, JSON-safe snapshot including live children; cached per state. */
  getSnapshot(): Snapshot
  /** Pure query: why a step is (not) where the caller expects (`machine/explain`); never throws. */
  explain(step: string): Explanation
  /** State listeners: once per committed batch. */
  subscribe(listener: (state: WizardState) => void): () => void
  /** Event listeners: every event of this wizard and its children (`event.path`). */
  observe(listener: (event: DomainEvent) => void): () => void
  log(): readonly DomainEvent[]
  /** Live nested runtime of a `flow` step. Throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`. */
  child(step: string): WizardRuntime
  /** Write a snapshot now (no-op without a store). */
  save(): Promise<void>
  dispose(): void
  isDisposed(): boolean
}

/**
 * Normalized options; shared by a root and all its children except `deps`, which each child
 * runtime receives for itself (`{ ...cfg, deps }` in the child factory).
 */
export interface RuntimeConfig {
  readonly machine: Machine
  readonly initialState: InitialState
  readonly env: RuntimeEnv
  /** This runtime's deps (`args.deps` in its hooks; the default for its children). */
  readonly deps: unknown
  readonly strict: 'sync' | undefined
  readonly logSize: number | undefined
  readonly abortGraceMs: number | undefined
  readonly onListenerError: ((error: unknown) => void) | undefined
  readonly persistence:
    | {
        readonly store: Store
        readonly key: string | undefined
        readonly autoSave: 'change' | 'off'
        readonly debounceMs: number
        readonly redact: ((snapshot: Snapshot) => unknown) | undefined
        readonly clearOnDone: boolean | undefined
        readonly onError: ((error: unknown) => void) | undefined
      }
    | undefined
  /**
   * Restore a child runtime from its prepared plan (resume path). Injected by
   * `resume.ts` so this module never imports it (no cycle); a runtime built by
   * `createWizardRuntime` never restores children.
   */
  readonly restore: RestoreChild
}

/**
 * What `resume.ts` prepared, recursively: the validated snapshot, the boundary-substituted
 * state (`epoch + 1`) and the plans of the children found in `snapshot.children`. Built once,
 * before anything is instantiated (atomic).
 */
export interface ResumePlan {
  readonly snapshot: Snapshot
  readonly state: WizardState
  readonly children: Readonly<Record<string, ResumePlan>>
}

export type RestoreChild = (
  def: CompiledFlow,
  plan: ResumePlan,
  cfg: RuntimeConfig,
  path: readonly string[],
  ancestors: readonly object[],
) => WizardRuntime

export interface BuildInit {
  readonly state: WizardState
  readonly path: readonly string[]
  readonly ancestors: readonly object[]
  /** Only the root persists; children ride along in `Snapshot.children`. */
  readonly persist: boolean
}

/** `WizardRuntime` plus the resume trigger used by `resume.ts`. */
export interface InternalRuntime extends WizardRuntime {
  /** Send the `resume` message and re-attach the prepared children (resume path only). */
  resumeFrom(plan: ResumePlan): void
}
