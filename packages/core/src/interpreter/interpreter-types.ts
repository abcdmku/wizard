import type { CompiledWizard } from '../authoring/compiled'
import type { Message } from '../machine/commands'
import type { Effect } from '../machine/effects'
import type { DomainEvent, DomainEventBody } from '../machine/events'
import type { WizardState } from '../machine/state'
import type { Snapshot } from '../wizard/snapshot'
import type { ChildFactory, ChildHandle, ParentLink } from './child'
import type { RuntimeEnv } from './env'
import type { Executor, ExecutorOptions } from './executor'
import type { ExpectedVersion } from './version-guard'

export interface InterpreterOptions<H extends ChildHandle = ChildHandle, P = Snapshot> {
  readonly def: CompiledWizard
  readonly path: readonly string[]
  readonly env: RuntimeEnv
  readonly initialState: WizardState
  /** Injected dependencies handed to every hook (`args.deps`). */
  readonly deps?: unknown
  readonly strict?: 'sync'
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number
  /** Dedupe window of `send` event ids (`MachineEnv.eventIds`). */
  readonly eventIds?: import('../machine/types').EventIdPolicy
  /** See `ExecutorOptions.abortGraceMs`. */
  readonly abortGraceMs?: number
  /** Replace the hook executor in tests. It receives the default executor's context. */
  readonly hooksExecutor?: (ctx: ExecutorOptions) => Executor
  /** Set on a child: the run that embeds it (see `ParentLink`). */
  readonly parent?: ParentLink
  /** Nested run support. Without a factory, `child.create` fails the child step. */
  readonly children?: {
    readonly factory: ChildFactory<H, P>
    readonly ancestors?: readonly object[]
    readonly maxDepth?: number
  }
  /** Every committed event, including events forwarded from children. */
  readonly onEvent?: (event: DomainEvent) => void
  /** Once per non-empty batch, when it commits (after the host barrier, if any). */
  readonly onCommit?: (state: WizardState, batch: readonly DomainEvent[]) => void
  /** Once per processed message, after commit. The batch may be empty. */
  readonly onProcessed?: (msg: Message, batch: readonly DomainEvent[], state: WizardState) => void
  /**
   * Host barrier: receives the staged view of a decided batch (and the child snapshots staged with
   * it) before it commits. Until it settles `getState()` / `childSnapshots()` still return the
   * previous committed pair and no effect of the batch runs.
   */
  readonly beforeEffects?: (
    state: WizardState,
    batch: readonly DomainEvent[],
    effects: readonly Effect[],
    children: Readonly<Record<string, Snapshot>>,
    message: Message,
  ) => void | Promise<void>
  /** Gate a timer callback before it enqueues its fire message. */
  readonly beforeTimer?: (
    timerId: string,
    at: number,
    expected: { readonly epoch: number; readonly seq: number },
  ) => boolean | Promise<boolean>
  /** Effects the interpreter does not execute itself. */
  readonly onEffect?: (effect: Effect) => void
  /** Called after the queue and any current host barrier have drained. */
  readonly onIdle?: () => void
  /** Called when a failed host barrier or a throw inside the drain aborts this runtime. */
  readonly onFatal?: (error: unknown) => void
  /** Listener exceptions are isolated. The default rethrows asynchronously. */
  readonly onListenerError?: (error: unknown) => void
}

export interface Interpreter<H extends ChildHandle = ChildHandle, P = Snapshot> {
  /** Enqueue a message. The interpreter drains synchronously unless a drain is already running. */
  send(msg: Message, causedBy?: number, expectedVersion?: ExpectedVersion): void
  /** The view of the last committed batch. */
  getState(): WizardState
  /** True only when no message or host barrier belongs to the current drain. */
  isIdle(): boolean
  /** Resolve after the current drain, or reject when disposed. */
  whenIdle(): Promise<void>
  /** Bounded ring of this instance's own events. */
  log(): readonly DomainEvent[]
  /** Record an out-of-band fact without changing state or incrementing the sequence. */
  record(body: DomainEventBody): void
  /** Clear timers, abort in-flight hooks, and dispose children. Idempotent. */
  dispose(): void
  isDisposed(): boolean
  /** Live child runtime for a `child` step, if created. */
  child(step: string): H | undefined
  /** Child snapshots paired with `getState()` (the committed ones while a barrier is pending or after stop). */
  childSnapshots(): Record<string, Snapshot>
  /** Reattach a child from its prepared resume plan. */
  restoreChild(step: string, plan: P): void
  /** Attach a prepared sibling tree before any restore notification can commit. */
  restoreChildren(plans: Readonly<Record<string, P>>): void
  /** Number of unsettled hook calls, for tests and diagnostics. */
  inflight(): number
  /** Unsettled hook calls that were not aborted: work whose result the run still waits for. */
  pending(): number
}
