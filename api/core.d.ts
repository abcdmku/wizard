//#region src/machine/each-state.d.ts
interface EachItem {
  readonly status: 'pending' | 'running' | 'done' | 'failed' | 'retrying';
  readonly attempt: number;
  readonly generation?: number;
  readonly idempotencyKey?: string;
  readonly output?: unknown;
  readonly error?: StepError$1;
  readonly retryAt?: number;
  readonly child?: ChildSummary$1;
}
type ItemNode = {
  readonly items: readonly (EachItem | null)[];
} | {
  readonly children: readonly (ItemNode | null)[];
};
interface EachRecords {
  /** Number of branch levels above the item leaves. */
  readonly depth: number;
  readonly root: ItemNode;
}
interface EachState {
  readonly items: readonly unknown[];
  readonly keys: readonly string[];
  readonly records: EachRecords;
  /** Next item that has never started. Retry items keep their original index. */
  readonly cursor: number;
  readonly running: number;
  readonly done: number;
  readonly childWaiting: number;
  readonly childHalted: number;
  readonly retrying: number;
}
//#endregion
//#region src/machine/commands.d.ts
type Command$1 = {
  readonly type: 'start';
} | {
  readonly type: 'next';
} | {
  readonly type: 'back';
} | {
  readonly type: 'go';
  readonly step: string;
  readonly reason?: string;
} | {
  readonly type: 'setInput';
  readonly step: string;
  readonly patch: unknown;
} | {
  readonly type: 'resetInput';
  readonly step: string;
} |
/**
 * External event whose payload was ALREADY parsed by the flow's event boundary. `eventId`
 * dedupes deliveries (D8): an id the run still remembers is a duplicate and changes nothing.
 */
{
  readonly type: 'send';
  readonly event: string;
  readonly payload: unknown;
  readonly correlationId?: string;
  readonly eventId?: string;
} |
/** External event that FAILED its boundary; recorded for observability. */
{
  readonly type: 'sendRejected';
  readonly event: string;
  readonly issues: readonly Issue$2[];
} | {
  readonly type: 'startStep';
  readonly step: string;
} | {
  readonly type: 'startReady';
} |
/** Re-run a failed runnable step; `patch` is merged into the context first (D12). */
{
  readonly type: 'retry';
  readonly step: string;
  readonly patch?: Readonly<Record<string, unknown>>;
} | {
  readonly type: 'cancel';
  readonly reason?: string;
} | {
  readonly type: 'compensate';
  readonly from?: string;
  readonly reason?: string;
} | {
  readonly type: 'reset';
} |
/** Skip a ready or active step that does not complete the flow. */
{
  readonly type: 'skip';
  readonly step: string;
  readonly reason?: string;
} |
/** Explicit invalidation of a done/failed/skipped step (+ transitive `needs` dependents when `cascade`). */
{
  readonly type: 'invalidate';
  readonly step: string;
  readonly cascade?: boolean;
} |
/** Address a command to a nested flow. `path` is relative to this run (`['fulfil']`, `['fulfil','payment']`). */
{
  readonly type: 'child';
  readonly path: readonly string[];
  readonly command: Command$1;
};
interface TimerFired {
  readonly type: 'timer.fired';
  readonly timerId: string;
}
//#endregion
//#region src/machine/state-support.d.ts
type StepErrorKind = 'validation' | 'guard' | 'run' | 'typed' | 'defect' | 'timeout' | 'compensate' | 'interrupted' | 'child' | 'hook' | 'sync-violation';
/** Serializable error. Never carries a stack. */
interface SerializedError$1 {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}
/** Standard Schema v1 issue, kept structural so core has zero runtime deps. */
interface Issue$2 {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | {
    readonly key: PropertyKey;
  }>;
}
/** Primary failure retained while a run is halted or compensating. */
interface FlowFailureState {
  readonly step?: string;
  readonly error: SerializedError$1;
  readonly kind?: StepErrorKind | 'runtime';
  readonly at?: number;
  readonly attempt?: number;
  readonly issues?: readonly Issue$2[];
  readonly data?: unknown;
}
interface CompensationFailureState {
  readonly step: string;
  readonly runId: number;
  readonly error: SerializedError$1;
}
/** `completed` = every compensation hook succeeded; `partial` = at least one failed (see `failures`). */
type CompensationOutcome = 'completed' | 'partial';
/** Exact terminal facts retained with a snapshot. */
interface TerminalState {
  readonly status: 'done' | 'failed' | 'cancelled';
  readonly output?: unknown;
  readonly failure?: FlowFailureState;
  readonly reason?: string;
  readonly compensation?: {
    readonly outcome: CompensationOutcome;
    readonly failures: readonly CompensationFailureState[];
  };
}
interface InboxEntry {
  readonly id: string;
  readonly event: string;
  readonly payload: unknown;
  readonly at: number;
  readonly expiresAt: number;
}
interface TimerEntry {
  readonly at: number;
  readonly fire: Command$1 | TimerFired;
  readonly purpose?: 'retry' | 'waitTimeout' | 'sleep' | 'inboxTtl' | 'compensationGrace';
  readonly step?: string;
}
//#endregion
//#region src/machine/state.d.ts
type StepStatus$1 = 'idle' | 'active' | 'done' | 'failed' | 'skipped' | 'cancelled' | 'compensating' | 'compensated';
type RunStatus$1 = 'idle' | 'running' | 'waiting' | 'halted' | 'done' | 'failed' | 'compensating' | 'cancelled';
type NavPhase = 'idle' | 'parsingInput' | 'validating' | 'canExit' | 'resolvingTarget' | 'canEnter' | 'exiting' | 'entering';
type NavCause = 'start' | 'next' | 'go' | 'back' | 'auto' | 'resume' | 'event';
interface StepError$1 extends SerializedError$1 {
  readonly kind: StepErrorKind;
  readonly at: number;
  readonly attempt?: number;
  /** Standard-Schema issues when kind === 'validation'. */
  readonly issues?: readonly Issue$2[];
  /** JSON-safe value produced by a runnable step's `mapError` (typed via `ErrorOf<F, K>`). */
  readonly data?: unknown;
}
interface GuardResult {
  readonly ok: boolean;
  /** seq of the event that recorded this result. */
  readonly seq: number;
  readonly reason?: string;
}
interface ChildSummary$1 {
  readonly status: RunStatus$1;
  readonly current: string | null;
  readonly progress: number;
  readonly seq: number;
}
interface StepRecord {
  readonly id: string;
  readonly kind: StepKind$1;
  readonly status: StepStatus$1;
  /** Draft input (view steps): raw, shallow-merged by `setInput`, parsed on next/go. */
  readonly input?: unknown;
  /**
   * Result of the step: parsed input (view), a `run` result, a resolving event, normalized
   * routing output, or child output (flow). Map outputs retain the input order.
   */
  readonly output?: unknown;
  /** Last validation issues (view). Cleared on the next input change. */
  readonly issues?: readonly Issue$2[];
  readonly error?: StepError$1;
  /** Output before the last explicit invalidation. */
  readonly previousOutput?: unknown;
  /** An explicit invalidation remains pending until the step is activated again. */
  readonly invalidated?: true;
  /**
   * Why the step was skipped: `'when'`, `'command'`, `'not-taken'`, `'needs-skipped'`,
   * `'fallback'` or `'timeout'`.
   */
  readonly skipReason?: string;
  /** Attempt counter for the current run (1-based while running; 0 when idle). */
  readonly attempt: number;
  /** Increments each time the step (re)starts after completion or invalidation. Used for stale-result tokens. */
  readonly runId: number;
  /** Scheduled retry time for a run. */
  readonly retryAt?: number;
  /** Absolute event timeout. Re-armed on resume. */
  readonly deadline?: number;
  /** Idempotency key for the current run. */
  readonly idempotencyKey?: string;
  readonly guards: {
    readonly canEnter?: GuardResult;
    readonly canExit?: GuardResult;
  };
  /**
   * State of the step's `when` predicate for the current activation — `'pending'` while the
   * call is in flight, `'passed'` once it returned true (the step may enter). Absent when the step
   * has no `when` hook or has not been evaluated yet; cleared on entry, skip and invalidation.
   */
  readonly when?: 'pending' | 'passed';
  /** Event sequence that identifies the current dynamic draft initializer call. */
  readonly initializing?: number;
  /** True while the step's `enter` hook is in flight (kind-specific work starts after it resolves). */
  readonly entering?: boolean;
  /** The `enter` hook already ran for the pending activation (transition `entering` phase); cleared when the step enters. */
  readonly enterDone?: boolean;
  /** Sequence of the most recent completion, used to select natural flow output. */
  readonly completedSeq?: number;
  readonly enteredAt?: number;
  readonly exitedAt?: number;
  /** When the step last settled (done, failed, skipped or cancelled). */
  readonly endedAt?: number;
  readonly visitedCount: number;
  /**
   * Set when `start`, a completed predecessor's `next` or a finished `needs` producer arrives
   * here while the step is not active; cleared when the step enters. Together with `needs`
   * gating this is the readiness rule: `ready = pendingActivation && depsSatisfied`.
   */
  readonly pendingActivation: boolean;
  /** seq of the arrival that set `pendingActivation` (scheduler picks ready steps in arrival order). */
  readonly arrivedSeq?: number;
  /** Child flow summary (flow steps). The full child snapshot lives in `Snapshot.children`. */
  readonly child?: ChildSummary$1;
  /** Snapshotted map items and their durable results. */
  readonly each?: EachState;
}
/** A delivered `send` event id and when it was delivered (ms). */
interface SeenEventId {
  readonly id: string;
  readonly at: number;
}
interface NavState {
  readonly phase: NavPhase;
  readonly txId?: string;
  readonly from?: string | null;
  /** Resolved target(s) of the in-flight transition (first = cursor target). */
  readonly targets?: readonly string[];
  readonly cause?: NavCause;
  readonly direction?: 'forward' | 'back';
  /** Targets still awaiting an initializer, `canEnter`, or `enter` result in the current phase. */
  readonly pendingSteps?: readonly string[];
  /** Auto-advance hop counter for the current command (guard against `next` loops). */
  readonly hops?: number;
  /** Sources of the latest auto-advances since the last async boundary (newest last, at most 4). */
  readonly trail?: readonly string[];
  /**
   * Non-view steps that completed while a transition was in flight; their
   * auto-advance starts (in order) as soon as `nav` returns to idle.
   * `to` = target override carried by `step.done.next`.
   */
  readonly deferred?: ReadonlyArray<{
    readonly step: string;
    readonly to?: string | readonly string[];
  }>;
  /**
   * The view a committed transition wanted as cursor but could not enter because its `when`
   * predicate was still unevaluated. Once the predicate passes, the cursor rule prefers this view
   * when several views are ready. Cleared when a cursor is set or the view enters/skips/invalidates.
   */
  readonly cursorHint?: string;
}
/** Identity of one completion of a compensable step (repeated activations produce several). */
interface SagaEntryRef {
  readonly step: string;
  readonly runId: number;
}
/** A completion pushed on the compensation stack, with the output snapshot the `compensate` hook receives. */
interface SagaEntry extends SagaEntryRef {
  readonly seq: number;
  readonly output?: unknown;
}
interface SagaState {
  /** Completions of steps with a `compensate` hook, in completion order (one entry per completion). */
  readonly stack: readonly SagaEntry[];
  readonly compensated: readonly SagaEntryRef[];
  readonly failures: readonly SagaEntryRef[];
  /** Compensation phase 1: steps whose `run` is still in flight and must settle before unwinding. */
  readonly settling?: readonly string[];
  /** The entry whose `compensate` call is in flight (one at a time). */
  readonly inFlight?: SagaEntryRef;
  /** Set while compensating: the run status `flow.compensated` ends in. */
  readonly outcome?: 'failed' | 'cancelled';
  readonly reason?: string;
}
interface WizardState {
  readonly status: RunStatus$1;
  /** UI cursor: the active view step, or null. */
  readonly current: string | null;
  /** Every step whose status is `active`, in activation order. */
  readonly active: readonly string[];
  readonly context: unknown;
  readonly steps: Readonly<Record<string, StepRecord>>;
  /** Visited view ids in navigation order (stack for `back`). */
  readonly history: readonly string[];
  readonly nav: NavState;
  readonly saga: SagaState;
  readonly inbox: readonly InboxEntry[];
  readonly timers: Readonly<Record<string, TimerEntry>>;
  /** Flow output once a completing step ran. */
  readonly output?: unknown;
  /** Primary failure retained for a recoverable halt and for compensation results. */
  readonly failure?: FlowFailureState;
  /** Persisted exact terminal facts; absent in pre-result snapshots. */
  readonly terminal?: TerminalState;
  readonly seq: number;
  readonly instanceId: string;
  /** Correlation id used to filter external events (`defineWizard({ correlate })`). */
  readonly correlationId?: string;
  /** Delivered `send` event ids still inside the dedupe window, oldest first (D8). */
  readonly eventIds?: readonly SeenEventId[];
  /** Increments on every resume so a restarted instance is distinguishable (Mirror frames carry `epoch` + `seq`). */
  readonly epoch: number;
  readonly flow: {
    readonly name: string;
    readonly version: number;
  };
  readonly startedAt: number | null;
  readonly updatedAt: number;
}
//#endregion
//#region src/machine/selectors.d.ts
/** UI-facing live phase of a step (undefined when the step has no live phase: idle/done/failed/…). */
type StepPhase$1 = 'blocked' | 'ready' | 'entering' | 'validating' | 'running' | 'retrying' | 'waiting' | 'exiting' | 'compensating';
/** Completion counters over all steps; `skipped` counts as done. */
interface Progress$1 {
  readonly done: number;
  readonly total: number;
  /** `done / total` (0 when there is nothing to count); 1 once the flow is `done`. */
  readonly ratio: number;
}
//#endregion
//#region src/authoring/types/primitives.d.ts
/**
 * A value or a promise of it ; every hook may be sync or async.
 * @public
 */
type MaybePromise<T> = T | Promise<T>;
/**
 * A duration: milliseconds as a number, or a string with a unit (`'250ms'`, `'15m'`, `'2h'`, `'1d'`).
 * @public
 */
type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;
/**
 * A JSON value (`meta` and other data that must survive `JSON.stringify` unchanged).
 * @public
 */
type JsonValue = string | number | boolean | null | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};
/**
 * A validation problem (Standard Schema issue shape): a message and an optional path.
 * @public
 */
type Issue$1 = Issue$2;
/**
 * A serializable error (`name`, `message`, optional `code`) ; never carries a stack.
 * @public
 */
type SerializedError = SerializedError$1;
/**
 * The three step kinds: `step | view | flow`. A plain step runs a hook, waits for an event,
 * sleeps until a deadline, or chooses its next steps.
 * @public
 */
type StepKind = StepKind$1;
/**
 * Stored status of a step: `idle | active | done | failed | skipped | cancelled | compensating | compensated`.
 * @public
 */
type StepStatus = StepStatus$1;
/**
 * Status of a run instance, including recoverable `halted` and terminal `failed`.
 * @public
 */
type RunStatus = RunStatus$1;
/**
 * Retry policy for runnable steps (plain data, so `inspect()` shows it; the retry STATE ; `attempt`, the
 * `retryAt` deadline ; is what persists, the policy is read from the flow): `retries` extra runs
 * after the first failure (`retries: 1` = at most two runs), spaced by `backoff` ; a number is a fixed
 * delay in ms (absent = retry immediately); `'exponential'` waits
 * `min(baseMs * factor^(attempt-1), maxBackoffMs)` (`baseMs` 200, `factor` 2, `maxBackoffMs` 30 000).
 * @public
 */
interface RetryPolicy<E = unknown> {
  readonly retries: number;
  readonly backoff?: number | 'exponential';
  readonly baseMs?: number;
  readonly factor?: number;
  readonly maxBackoffMs?: number;
  /** Randomize each delay by up to this fraction (0..1). */
  readonly jitter?: number;
  /** Retry only when this returns true; receives the mapped error when `mapError` exists. */
  readonly when?: (error: E) => boolean;
}
/**
 * Progress of a run (`run.progress()`, `ClientState.progress` with `expose.progress: true`):
 * Counts completed or skipped steps and reports their fraction of the total.
 * @public
 */
type Progress = Progress$1;
/** Default of an inference site that was not given (distinct from `never`, which a value can have). */
declare const UNSET: unique symbol;
interface Unset {
  readonly [UNSET]: true;
}
type IsUnset<X> = 0 extends 1 & X ? false : [X] extends [Unset] ? [Unset] extends [X] ? true : false : false;
//#endregion
//#region src/authoring/compiled.d.ts
type StepKind$1 = 'step' | 'view' | 'flow';
/** Result of parsing through a boundary. */
type BoundaryResult<T = unknown> = {
  readonly ok: true;
  readonly value: T;
} | {
  readonly ok: false;
  readonly issues: readonly Issue$2[];
};
//#endregion
//#region ../../node_modules/.pnpm/@standard-schema+spec@1.1.0/node_modules/@standard-schema/spec/dist/index.d.ts
/** The Standard Typed interface. This is a base type extended by other specs. */
interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}
declare namespace StandardTypedV1 {
  /** The Standard Typed properties interface. */
  interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }
  /** The Standard Typed types interface. */
  interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }
  /** Infers the input type of a Standard Typed. */
  type InferInput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard Typed. */
  type InferOutput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
/** The Standard Schema interface. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    /** Validates unknown input values. */
    readonly validate: (value: unknown, options?: StandardSchemaV1.Options | undefined) => Result<Output> | Promise<Result<Output>>;
  }
  /** The result interface of the validate function. */
  type Result<Output> = SuccessResult<Output> | FailureResult;
  /** The result interface if validation succeeds. */
  interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined;
  }
  interface Options {
    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  /** The result interface if validation fails. */
  interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }
  /** The issue interface of the failure output. */
  interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  /** The path segment interface of the issue. */
  interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<Input, Output> {}
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}
//#endregion
//#region src/authoring/types/boundary.d.ts
/**
 * Runtime brand of a `Checker`. A module-private `Symbol()` (deliberately not `Symbol.for`,
 * which anyone could look up): only `boundary.parse/guard/assert/trusted` can mint a checker,
 * so a forged `{ '~checker': 'assert' }` object is never a boundary. Not exported from the
 * package; the `Checker` type is nominal through this key.
 * @internal
 */
declare const CHECKER: unique symbol;
/**
 * The four checker kinds: `parse` (return or throw), `guard` (predicate), `assert` (assertion
 * function) and `trusted` (no runtime check).
 * @public
 */
type CheckerKind = 'parse' | 'guard' | 'assert' | 'trusted';
/**
 * A branded runtime checker built by `boundary.parse/guard/assert/trusted`. `I` is the
 * input type equals `O` for checkers. The private brand keeps plain
 * functions and hand-written objects out.
 * @public
 */
interface Checker<O, I = O> {
  readonly [CHECKER]: CheckerKind;
  readonly '~types'?: {
    readonly input: I;
    readonly output: O;
  };
}
/**
 * A Standard Schema, such as Zod, Valibot or ArkType, or a branded checker.
 * `O` is the parsed output type, `I` the accepted input (draft) type.
 * @public
 */
type Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>;
//#endregion
//#region src/authoring/run-adapter.d.ts
/** A failure channel produced by a run adapter. @public */
type RunFailureKind = 'typed' | 'defect' | 'interrupted';
/**
 * Internal marker carried by an adapter rejection. `data` is only included after the adapter
 * has validated it with its durable error schema.
 * @public
 */
interface RunFailure {
  readonly [RUN_FAILURE]: true;
  readonly kind: RunFailureKind;
  readonly error: unknown;
  readonly data?: JsonValue;
}
/** Runtime marker for adapter-produced failures. @public */
declare const RUN_FAILURE: unique symbol;
/** Construct a runtime-neutral adapter failure envelope. @public */
declare function createRunFailure(kind: RunFailureKind, error: unknown, data?: JsonValue): RunFailure;
/** Test for an adapter failure without depending on the optional integration. @public */
declare function isRunFailure(value: unknown): value is RunFailure;
/** Metadata installed by a run adapter. @public */
interface RunAdapterMetadata<C, D, A, E extends JsonValue = never, Args extends RunArgs<C, D> = RunArgs<C, D>> {
  readonly run: (args: Args) => MaybePromise<A>;
  readonly output: Boundary<A, unknown>;
  /** Phantom error channel retained for `ErrorOf<F, K>` inference. */
  readonly '~error'?: E;
}
/** Runtime-neutral run adapter. Execution lives in metadata, so the adapter is not callable. @public */
interface RunAdapter<C, D, A, E extends JsonValue = never, Args extends RunArgs<C, D> = RunArgs<C, D>> {
  readonly [RUN_ADAPTER]: RunAdapterMetadata<C, D, A, E, Args>;
}
/** Runtime marker for run adapters. @public */
declare const RUN_ADAPTER: unique symbol;
/** Test for an adapter returned by an optional integration. @public */
declare function isRunAdapter(value: unknown): value is RunAdapter<unknown, unknown, unknown, JsonValue>;
//#endregion
//#region src/authoring/types/step-record.d.ts
interface StepRecordConfig {
  readonly label?: string;
  readonly description?: string;
  readonly meta?: Readonly<Record<string, JsonValue>>;
  readonly needs?: Readonly<Record<string, unknown>>;
  readonly when?: (args: never) => unknown;
  readonly enter?: (args: never) => unknown;
  readonly exit?: (args: never) => unknown;
  readonly next?: Ref | readonly Ref[] | null | ((args: never) => unknown);
  readonly targets?: readonly Ref[];
  readonly on?: Readonly<Record<string, (args: never) => unknown>>;
  readonly run?: ((args: never) => unknown) | RunAdapter<never, never, unknown, JsonValue>;
  readonly each?: (args: never) => unknown;
  readonly key?: (item: never, index: number) => string;
  readonly concurrency?: number;
  readonly output?: Boundary<unknown, unknown>;
  readonly retry?: RetryPolicy<never>;
  readonly timeout?: Duration | {
    readonly after: Duration;
    readonly next: Ref;
  };
  readonly compensate?: (args: never) => unknown;
  readonly idempotencyKey?: boolean | ((args: never) => string);
  readonly mapError?: (error: unknown, args: never) => unknown;
  readonly fallback?: Ref;
  readonly waitFor?: Readonly<Record<string, (args: never) => unknown>>;
  readonly sleep?: Duration | ((args: never) => Duration);
  readonly input?: Boundary<unknown, unknown>;
  readonly initial?: unknown;
  readonly validate?: (args: never) => unknown;
  readonly canEnter?: (args: never) => unknown;
  readonly canExit?: (args: never) => unknown;
  readonly context?: (args: never) => unknown;
  readonly deps?: (args: never) => unknown;
}
//#endregion
//#region src/authoring/types/step.d.ts
/** Anything a constructor returned (refs, needs). */
interface StepLike {
  readonly config: StepRecordConfig;
  readonly kind: StepKind;
  readonly '~types': unknown;
  readonly '~links': unknown;
  readonly '~bound': unknown;
}
/** A reference to a step: its id, or the step object itself. */
type Ref = string | StepLike;
/**
 * What a function `next` may return. Id targets keep id returns checked here (the error stays on the
 * `next` line); step objects in either list are checked by `steps()` (`Route`), which can resolve them.
 */
type RefWithin<Tg> = [Tg] extends [never] ? Ref : [Extract<Tg, StepLike>] extends [never] ? Tg | StepLike : Ref;
/** What a function `next` returns; a bare fallback to the constraint (it returns only `null`) is nothing. */
type Returned<Nr, Tg> = [RefWithin<Tg>] extends [Nr] ? never : Nr;
/** Recorded when a step object is involved, so `steps()` checks the returns against `targets`. */
type Route<Nr, Tg> = [Extract<Nr | Tg, StepLike>] extends [never] ? never : {
  readonly ret: Nr;
  readonly tg: Tg;
};
/**
 * TypeScript also infers a function `next` (at low priority) into the static-ref parameter `Nx`,
 * which then falls back to its constraint `Ref | null`; that fallback means "no static next".
 */
type StaticNext<Nx> = [Ref | null] extends [Nx] ? never : Nx;
/** Per-step facts every consumer reads (`OutputOf`, `ViewId`, `RunStepId`, ). */
interface StepFacts {
  readonly output: unknown;
  readonly input?: unknown;
  readonly child?: unknown;
  readonly error?: unknown;
  readonly runnable?: boolean;
  readonly each?: boolean;
}
/** Facts only `steps()` reads: references, needs, successors and constructor-level problems. */
/** `cond`: the step has its own `when`, so it may be skipped. */
interface Links<Refs extends string, Objs, Needs, Alt, Succ extends boolean, Problem extends string, Cond extends boolean = false, Rt = never> {
  readonly cond: Cond;
  readonly route: Rt;
  readonly refs: Refs;
  readonly objs: Objs;
  readonly needs: Needs;
  readonly alt: Alt;
  readonly succ: Succ;
  readonly problem: Problem;
}
interface Binding<C, Ev, D> {
  readonly context: C;
  readonly events: Ev;
  readonly deps: D;
}
/** Invariant probe for the definition facts the step was built with. */
type BoundTo<C, Ev, D> = (facts: Binding<C, Ev, D>) => Binding<C, Ev, D>;
/**
 * A step as returned by `step`, `view` or `flow` (every field present; values are phantom).
 * `'~exact'` makes a step invariant in its facts, so `steps()` matches a `needs` ref to the map
 * entry it IS rather than to any step whose output happens to be a subtype.
 */
/** A constructor record with authored config and inference facts. @public */
interface Step<K extends StepKind, X extends StepFacts, L, B> {
  readonly kind: K;
  readonly config: StepRecordConfig;
  readonly child?: X extends {
    readonly child: infer CF;
  } ? CF : never;
  readonly '~types': X | undefined;
  readonly '~links': L | undefined;
  readonly '~bound': B | undefined;
  readonly '~exact': ((facts: X, links: L) => void) | undefined;
}
/** Whether a step's output can be the wizard output: no successor (`sink`), maybe skipped (`maybe`). */
type SinkRole = 'sink' | 'maybe' | 'inner';
/** A step as stored in an assembled wizard: kind, facts and sink role only. */
/** Compact step facts and its sink role in the assembled wizard. @public */
interface FlowStep<K extends StepKind, X extends StepFacts, Role extends SinkRole> {
  readonly kind: K;
  readonly '~types': X | undefined;
  readonly '~role': Role | undefined;
}
/** Structural constraint for generic step modules. */
/** A structural constraint for generic step modules and references. @public */
type AnyStep = StepLike;
//#endregion
//#region src/authoring/types/hook-args.d.ts
/** Keys to change; an optional key may be cleared with `undefined`. */
/** A shallow context patch that can clear optional properties. @public */
type ContextPatch<C> = { readonly [K in keyof C]?: C[K] | ({} extends Pick<C, K> ? undefined : never); };
/** What every hook receives. `N` is the typed `needs` map (`{}` without `needs`). */
/** Shared hook arguments including typed needs and atomic context updates. @public */
interface HookArgs<C, D, N = {}> {
  readonly context: C;
  /** Patch the context; the function form applies atomically to the latest committed context. */
  readonly update: (patch: ContextPatch<C> | ((current: C) => ContextPatch<C>)) => void;
  readonly deps: D;
  /** Transient progress, published to observers and never persisted. */
  readonly progress: (value: JsonValue) => void;
  readonly needs: N;
  readonly step: string;
  /** Run path (`[]` for this run, `['fulfil']` inside a child). */
  readonly path: readonly string[];
  readonly signal: AbortSignal;
}
/** Entry arguments including the previous view and typed needs. @public */
interface EnterArgs<C, D, N = {}> extends HookArgs<C, D, N> {
  readonly from: string | null;
}
/** Hook arguments carrying a resolved step output. @public */
interface OutputArgs<C, D, O, N = {}> extends HookArgs<C, D, N> {
  readonly output: O;
}
/** Exit arguments with the resolved output and destination view. @public */
interface ExitArgs<C, D, O, N = {}> extends OutputArgs<C, D, O, N> {
  readonly to: string | null;
}
/** Compensation arguments with a stable idempotency key. @public */
interface CompensateArgs<C, D, O, N = {}> extends OutputArgs<C, D, O, N> {
  readonly reason: string | undefined;
  /** Stable per compensation of this step run. */
  readonly idempotencyKey: string;
}
/** Run arguments with attempt, idempotency key and typed needs. @public */
interface RunArgs<C, D, N = {}> extends HookArgs<C, D, N> {
  readonly attempt: number;
  readonly idempotencyKey: string;
}
interface ItemArgs<Item> {
  readonly item: Item;
  readonly index: number;
}
/** Run arguments for one item in a mapped runnable step. @public */
interface EachRunArgs<C, D, N, Item> extends RunArgs<C, D, N>, ItemArgs<Item> {}
/** Hook arguments for one item in a mapped child flow. @public */
interface EachHookArgs<C, D, N, Item> extends HookArgs<C, D, N>, ItemArgs<Item> {}
/** Step event arguments with a parsed payload and typed needs. @public */
interface EventArgs<C, D, P, E, N = {}> extends HookArgs<C, D, N> {
  readonly event: E;
  readonly payload: P;
}
type HookArgsFor<C, D, N, Item> = IsUnset<Item> extends true ? HookArgs<C, D, N> : EachHookArgs<C, D, N, Item>;
/** Flow-level handlers do not belong to one step. */
/** Flow event arguments with the parsed event payload. @public */
interface FlowOnArgs<C, D, P, E = string> extends Omit<HookArgs<C, D>, 'step' | 'needs' | 'progress'> {
  readonly event: E;
  readonly payload: P;
}
//#endregion
//#region src/authoring/types/step-inference.d.ts
type OutputOfStep<S> = S extends {
  readonly '~types': infer P;
} ? NonNullable<P> extends {
  readonly output: infer O;
} ? O : never : never;
/** `needs: { alias: step | { any: [steps] } | { optional: step } }`. */
/** One need: a step object, the first of several (`any`), or a step that may be skipped (`optional`). */
/** One data requirement: a step, the first of several, or an optional step. @public */
type NeedRef = StepLike | {
  readonly any: readonly StepLike[];
} | {
  readonly optional: StepLike;
};
/** Named data requirements referencing earlier step objects. @public */
type NeedsSpec = {
  readonly [alias: string]: NeedRef;
};
type NeedOutput<S> = S extends string ? any : S extends {
  readonly any: readonly (infer R)[];
} ? OutputOfStep<R> : S extends {
  readonly optional: infer R;
} ? OutputOfStep<R> | undefined : OutputOfStep<S>;
/** The typed `args.needs` of a step. */
/** The parsed outputs exposed by the aliases in needs. @public */
type NeedsOutput<Nd> = { readonly [A in keyof Nd]: NeedOutput<Nd[A]>; };
type NeedStep<S> = S extends {
  readonly any: readonly (infer R)[];
} ? R : S extends {
  readonly optional: infer R;
} ? R : S;
type NeedSteps<Nd> = { [A in keyof Nd]: NeedStep<Nd[A]>; }[keyof Nd];
/** Only the facts a step has, so hovers and errors print `{ output; runnable }` rather than `error: never`. */
type RunFacts<O, E, Rn extends boolean> = Rn extends false ? {
  readonly output: O;
} : [E] extends [never] ? {
  readonly output: O;
  readonly runnable: true;
} : {
  readonly output: O;
  readonly error: E;
  readonly runnable: true;
};
type EachOf<Item, O> = IsUnset<Item> extends true ? O : O[];
type DoneOf<R, P> = R extends {
  readonly done: infer X;
} ? X : R extends {
  readonly keep: true;
} | {
  readonly fail: string;
} ? never : P;
type WaitOutput<H, Ev> = { [E in keyof H]: E extends keyof Ev ? H[E] extends ((...args: never[]) => infer R) ? DoneOf<Awaited<R>, Ev[E]> : never : never; }[keyof H];
/**
 * `Xk` = the keys written in the config literal. TypeScript re-infers a failing call without its
 * context-sensitive callbacks, so a `run` / `waitFor` it could not type leaves `R` / `H` unset
 * while `Xk` still lists it: the output is then `any`, so the one error does not cascade into
 * every step that `needs` this one.
 */
type StepEach<Xk, O> = 'each' extends Xk ? O[] : O;
type StepOutput<R, OB, _Item, H, Ev, Xk> = IsUnset<OB> extends false ? StepEach<Xk, OB> : 'run' extends Xk ? StepEach<Xk, RunOutput<R>> : [keyof H] extends [never] ? 'waitFor' extends Xk ? any : undefined : WaitOutput<H, Ev>;
type ErrorFor<Em, Ea> = IsUnset<Em> extends true ? Ea : Em;
type RetryError<Em, Ea> = [ErrorFor<Em, Ea>] extends [never] ? unknown : ErrorFor<Em, Ea>;
type AdapterErrorChannel<V> = V extends {
  readonly [RUN_ADAPTER]: unknown;
} ? V extends RunAdapter<infer _C, infer _D, infer _A, infer E, infer _Args> ? E : never : never;
type AdapterOutput<V> = V extends {
  readonly [RUN_ADAPTER]: unknown;
} ? V extends RunAdapter<infer _C, infer _D, infer A, infer _E, infer _Args> ? A : V : V;
/** Failed callback inference must not create a spurious typed adapter error channel. */
type ReturnedAdapterError<R> = 0 extends 1 & Awaited<R> ? never : AdapterErrorChannel<Awaited<R>>;
type RunOutput<R> = AdapterOutput<Awaited<R>>;
type BoundAdapterProblem<V, C, D, Nd, Item, Xk> = V extends {
  readonly [RUN_ADAPTER]: unknown;
} ? V extends RunAdapter<infer _C, infer _D, infer _A, infer _E, infer Accepted> ? ['each' extends Xk ? EachRunArgs<C, D, NeedsOutput<Nd>, Item> : RunArgs<C, D, NeedsOutput<Nd>>] extends [Accepted] ? never : 'returned adapter requires different context, deps, needs, or each item' : 'returned adapter must match RunAdapter with JSON error data' : never;
type ReturnedAdapterProblem<R, C, D, Nd, Item, Xk> = 0 extends 1 & Awaited<R> ? never : BoundAdapterProblem<Awaited<R>, C, D, Nd, Item, Xk>;
type NextProblem<Nr, Tg> = [Nr] extends [never] ? never : [Tg] extends [never] ? 'a function `next` must declare `targets` (the ids or steps it may return)' : never;
type RoutingProblem<Xk, Nx, Nr, Tg> = 'next' extends Xk ? [StaticNext<Nx>] extends [never] ? [Tg] extends [never] ? 'a function `next` must declare `targets` (the ids or steps it may return)' : NextProblem<Nr, Tg> : 'targets' extends Xk ? '`targets` requires a function `next`' : never : 'targets' extends Xk ? '`targets` requires a function `next`' : never;
type IdRefs<X> = Extract<X, string>;
type ObjRefs<X> = Extract<X, StepLike>;
type HasSuccessor<Nx, Tg> = [Extract<StaticNext<Nx>, Ref> | Tg] extends [never] ? false : true;
type Behaviors<Xk> = Extract<Xk, 'run' | 'waitFor' | 'sleep'>;
type RunOnly<Xk> = Extract<Xk, 'retry' | 'compensate' | 'mapError' | 'idempotencyKey' | 'output' | 'fallback' | 'each'>;
type IsUnion<U, A = U> = U extends unknown ? ([A] extends [U] ? false : true) : never;
/** Option combinations a step config cannot have (read from the keys it was written with). */
type StepProblems<Xk, To> = (true extends IsUnion<Behaviors<Xk>> ? 'a step has one behavior: `run`, `waitFor` or `sleep`' : never) | ('run' extends Xk ? never : [RunOnly<Xk>] extends [never] ? never : `\`${RunOnly<Xk> & string}\` only applies to a step with \`run\``) | ('each' extends Xk ? never : [Extract<Xk, 'key' | 'concurrency'>] extends [never] ? never : '`key` / `concurrency` need `each`') | ([To] extends [never] ? never : 'waitFor' extends Xk ? never : '`timeout: { after, next }` is only valid on a waitFor step');
//#endregion
//#region src/authoring/types/assembly.d.ts
type StepError<M> = { readonly [P in M & string]: never; };
type LinksOf<S> = S extends {
  readonly '~links': infer L;
} ? NonNullable<L> : never;
type LinkFact<S, F extends 'needs' | 'alt' | 'succ' | 'cond'> = LinksOf<S> extends (infer L) ? (F extends keyof L ? L[F] : never) : never;
type Quoted<X> = X extends string ? `'${X}'` : never;
type EmptyAny<Nd> = { [A in keyof Nd]: Nd[A] extends {
  readonly any: readonly never[];
} ? A : never; }[keyof Nd];
type IdNeeds<Nd> = { [A in keyof Nd]: Nd[A] extends string ? A : never; }[keyof Nd];
type ForeignNeeds<T, Nd> = { [A in keyof Nd]: Nd[A] extends string ? never : [NeedStep<Nd[A]>] extends [T[keyof T]] ? never : A; }[keyof Nd];
type ForeignProblem<T, K extends string, Nd> = [IdNeeds<Nd>] extends [never] ? ForeignStep<T, K, Nd> : `step '${K}': need ${Quoted<IdNeeds<Nd> & string>} must be a step object (const x = step(...)), not an id`;
type ForeignStep<T, K extends string, Nd> = [ForeignNeeds<T, Nd>] extends [never] ? `step '${K}' references a step object that is not part of this steps() map` : `step '${K}' needs ${Quoted<ForeignNeeds<T, Nd> & string>}, which is not a step of this wizard (declare it in this steps() map, built with this wizard's api)`;
type KeysOf<T, O> = { [K in keyof T]: [T[K]] extends [O] ? K : never; }[keyof T];
type EscapedIds<T, Rt> = Rt extends {
  readonly ret: infer R;
  readonly tg: infer G;
} ? [Extract<R, string>] extends [never] ? never : Exclude<Extract<R, string>, Extract<G, string> | KeysOf<T, Extract<G, StepLike>>> : never;
type EscapedObjs<T, Rt> = Rt extends {
  readonly ret: infer R;
  readonly tg: infer G;
} ? [Extract<R, StepLike>] extends [Extract<G, StepLike> | T[Extract<G, string> & keyof T]] ? never : true : never;
type RouteProblem<T, K extends string, Rt> = [EscapedIds<T, Rt>] extends [never] ? [EscapedObjs<T, Rt>] extends [never] ? never : `step '${K}': next may return a step object that is not in targets` : `step '${K}': next may return ${Quoted<EscapedIds<T, Rt>>}, which is not in targets`;
type LinkProblem<T, K extends string, L> = L extends Links<infer Refs, infer Objs, infer Nd, infer _A, infer _S, infer P, infer _W, infer Rt> ? [P] extends [never] ? string extends Refs ? `step '${K}' references an id typed as plain string; use a literal id or the step object` : [Exclude<Refs, keyof T>] extends [never] ? [Objs | NeedSteps<Nd>] extends [T[keyof T]] ? [EmptyAny<Nd>] extends [never] ? RouteProblem<T, K, Rt> : `step '${K}': need ${Quoted<EmptyAny<Nd> & string>} lists no steps (\`any\` needs at least one)` : ForeignProblem<T, K, Nd> : `step '${K}' references unknown step id ${Quoted<Exclude<Refs, keyof T>>}` : `step '${K}': ${P}` : never;
type StepProblem<T, K extends string, C, Ev, D> = T[K & keyof T] extends {
  readonly '~links': infer L;
  readonly '~bound': infer B;
} ? [B] extends [BoundTo<C, Ev, D> | undefined] ? LinkProblem<T, K, NonNullable<L>> : `step '${K}' is bound to a different context/events/deps than this wizard` : `'${K}' is not a step: create it with step(), view() or flow()`;
/** Each invalid property gets an error whose first key is the diagnostic message. */
type CheckSteps<T, C, Ev, D> = { readonly [K in keyof T]: StepProblem<T, K & string, C, Ev, D> extends (infer P) ? [P] extends [never] ? T[K] : StepError<P> : never; } & (string extends keyof T ? StepError<'steps must be declared with literal keys'> : unknown) & ([keyof T] extends [never] ? StepError<'a wizard needs at least one step'> : unknown);
type AllAlts<T> = { [K in keyof T]: LinkFact<T[K], 'alt'>; }[keyof T];
/**
 * `inner`: has a successor or is pulled by a `needs`. Steps are matched by type, so a needed step
 * with an identical twin in the map stays a (maybe-skipped) sink rather than risk dropping an output.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type KeyedOf<T, Nd> = { [A in keyof Nd]: A extends keyof T ? (Same<Nd[A], T[A]> extends true ? A : never) : never; }[keyof Nd];
type LooseOf<T, Nd> = { [A in keyof Nd]: A extends keyof T ? Same<Nd[A], T[A]> extends true ? never : NeedStep<Nd[A]> : NeedStep<Nd[A]>; }[keyof Nd];
/** Keys pulled by a shorthand need (`needs: { a }`): the alias is the id and the step matches. */
type KeyedNeeds<T> = { [K in keyof T]: KeyedOf<T, LinkFact<T[K], 'needs'>>; }[keyof T];
/** Needs matched only by type (renamed alias, `any`, `optional`). */
type LooseNeeds<T> = { [K in keyof T]: LooseOf<T, LinkFact<T[K], 'needs'>>; }[keyof T];
type Leaves<T> = { [K in keyof T]: LinkFact<T[K], 'succ'> extends true ? never : K; }[keyof T];
/**
 * Any `when`, target, fallback or timeout edge can skip steps downstream; until a bounded
 * "surely runs" pass exists, every sink of such a map may be skipped (types never drop `undefined`).
 */
type HasBranches<T> = true extends { [K in keyof T]: LinkFact<T[K], 'cond'>; }[keyof T] ? true : [AllAlts<T>] extends [never] ? false : true;
type RoleOf<T, K extends keyof T> = LinkFact<T[K], 'succ'> extends true ? 'inner' : K extends KeyedNeeds<T> ? 'inner' : [T[K]] extends [LooseNeeds<T>] ? [T[K]] extends [T[Exclude<Leaves<T>, K>]] ? 'maybe' : 'inner' : HasBranches<T> extends true ? 'maybe' : 'sink';
type CompactStep<S, Role extends SinkRole> = S extends Step<infer K, infer X, infer _L, infer _B> ? FlowStep<K, X, Role> : never;
//#endregion
//#region src/interpreter/env.d.ts
/**
 * Wall clock the runtime reads for timestamps and timer deadlines (`wizard.create(input, { clock })`).
 * @public
 */
interface Clock {
  /** Monotonic-enough wall clock in ms. */
  now(): number;
}
/**
 * Timer scheduler the runtime arms retries, wait timeouts and inbox TTLs with
 * (`wizard.create(input, { scheduler })`). Handles are opaque: the runtime only ever passes them back
 * to `clearTimeout` of the same scheduler.
 * @public
 */
interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
interface IdGenerator {
  /** Unique id with a readable prefix (`tx`, `fx`, `evt`, `wiz`, ...). */
  id(prefix: string): string;
}
//#endregion
//#region src/persistence/store.d.ts
/**
 * Store — the persistence port. One snapshot per key; the value is whatever
 * `toSnapshot()` produced (after `redact`, if configured), JSON-checked right
 * before `set` (a write of a non-JSON snapshot never reaches the store —
 * `onPersistError` / `persist.failed`). Single-owner: one live run
 * per key, no compare-and-swap or lease.
 *
 * Implementations are the host's job; core ships
 * `createMemoryStore()` for tests and single-process apps. Keys should be
 * tenant-scoped by the host (see SECURITY.md).
 *
 * @public
 */
interface Store {
  /** `null` when the key is unknown. */
  get(key: string): Promise<unknown | null>;
  set(key: string, snapshot: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
//#endregion
//#region src/errors.d.ts
/**
 * Stable error codes carried by `WizardError` and by `{ ok: false }` results.
 *
 * @public
 */
type WizardErrorCode = 'UNKNOWN_STEP' | 'UNKNOWN_EVENT' | 'NOT_A_VIEW' | 'NOT_RUNNABLE' | 'NOT_A_FLOW_STEP' | 'NOT_ACTIVE' | 'NOT_REACHABLE' | 'NAV_BUSY' | 'NO_TARGET' | 'NO_HISTORY' | 'INVALID_INPUT' | 'INVALID_ARGUMENT' | 'BOUNDARY_REJECTED' | 'GUARD_BLOCKED' | 'CANCELLED' | 'FLOW_TERMINAL' | 'FLOW_HALTED' | 'FLOW_NOT_STARTED' | 'INVALID_COMMAND' | 'SYNC_VIOLATION' | 'SNAPSHOT_INCOMPATIBLE' | 'SNAPSHOT_NOT_SERIALIZABLE' | 'NESTING_CYCLE' | 'NESTING_TOO_DEEP' | 'DEFINITION_INVALID' | 'DISPOSED';
/**
 * Error thrown for programmer errors (misuse of the API): unknown event names,
 * incompatible snapshots, invalid definitions, disposed runs. Data problems
 * (validation, rejected commands) are returned as `{ ok: false }` results instead.
 *
 * @public
 */
declare class WizardError extends Error {
  readonly code: WizardErrorCode;
  readonly step?: string;
  readonly issues?: readonly Issue$2[];
  constructor(code: WizardErrorCode, message: string, options?: {
    step?: string;
    issues?: readonly Issue$2[];
    cause?: unknown;
  });
}
/**
 * Type guard for `WizardError`.
 *
 * @public
 */
declare function isWizardError(value: unknown): value is WizardError;
//#endregion
//#region src/machine/event-lifecycle.d.ts
type LifecycleEventBody = EachEventBody | {
  readonly type: 'flow.started';
  readonly start: string;
} | {
  readonly type: 'flow.done';
  readonly output?: unknown;
} |
/** Terminal failure: nothing can recover the run (a halted run emits `flow.halted` instead). */
{
  readonly type: 'flow.failed';
  readonly step?: string;
  readonly error: SerializedError$1;
  /** `AUTO_ADVANCE_LOOP`: synchronous `next` hops without an async boundary (absent: `output` failed). */
  readonly code?: 'AUTO_ADVANCE_LOOP';
  /** The runnable step's `mapError` value, when present. */
  readonly data?: unknown;
} |
/** A step failed under `onFailure: 'halt'`: the run stops scheduling until retry / skip / run / compensate / cancel. */
{
  readonly type: 'flow.halted';
  readonly step: string;
  readonly error: SerializedError$1;
  /** The runnable step's `mapError` value, when present. */
  readonly data?: unknown;
} |
/** `status` = the run status `flow.compensated` ends in ('cancelled' when triggered by `cancel`, else 'failed'). */
{
  readonly type: 'flow.compensating';
  readonly reason?: string;
  readonly plan: readonly string[];
  readonly status?: 'failed' | 'cancelled';
} |
/** `failures` = steps whose compensation failed (empty = every compensation hook succeeded). */
{
  readonly type: 'flow.compensated';
  readonly failures: readonly string[];
  readonly status: 'failed' | 'cancelled';
} | {
  readonly type: 'flow.cancelled';
  readonly reason?: string;
} | {
  readonly type: 'flow.resumed';
  readonly fromSeq: number;
  readonly interrupted: readonly string[];
} | {
  readonly type: 'flow.reset';
} | {
  readonly type: 'flow.status';
  readonly status: RunStatus$1;
} | {
  readonly type: 'transition.started';
  readonly txId: string;
  readonly from: string | null;
  readonly to?: string;
  readonly cause: NavCause;
  /** Auto-advance only: synchronous hops since the last async boundary (the loop guard). */
  readonly hops?: number;
} |
/** `targets` is set on the first phase event emitted after the target list is known (static/dynamic `next`). */
{
  readonly type: 'transition.phase';
  readonly txId: string;
  readonly phase: NavPhase;
  readonly targets?: readonly string[];
} | {
  readonly type: 'transition.committed';
  readonly txId: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly cause: NavCause;
  readonly direction: 'forward' | 'back';
} | {
  readonly type: 'transition.rejected';
  readonly txId: string;
  readonly reason: TransitionRejectReason;
  readonly step?: string;
  readonly issues?: readonly Issue$2[];
} | {
  readonly type: 'transition.failed';
  readonly txId: string;
  readonly step: string;
  readonly error: SerializedError$1;
} | {
  readonly type: 'step.arrived';
  readonly step: string;
  readonly from: string | null;
} |
/** `enterPending: true` = the step's `enter` hook still has to run (scheduler entry); absent when there is no hook or it already ran in the transition's `entering` phase. */
{
  readonly type: 'step.entered';
  readonly step: string;
  readonly from: string | null;
  readonly runId: number;
  readonly enterPending?: boolean;
} |
/** The step's `enter` hook resolved; kind-specific work may start (see machine-spec §2). */
{
  readonly type: 'step.enterCompleted';
  readonly step: string;
} | {
  readonly type: 'step.exited';
  readonly step: string;
  readonly to: string | null;
  readonly direction: 'forward' | 'back';
} |
/** `next` = the targets the `next` function of a routing step chose. */
{
  readonly type: 'step.done';
  readonly step: string;
  readonly output?: unknown;
  readonly next?: string | readonly string[];
} |
/** `data` = the runnable step's `mapError` value for this failure. */
{
  readonly type: 'step.failed';
  readonly step: string;
  readonly error: SerializedError$1;
  readonly kind: StepFailureKind;
  readonly data?: unknown;
} |
/**
 * `reason`: `'when'`, `'command'`, `'not-taken'` (a routing decision chose another declared
 * target), `'needs-skipped'` (a step it needs was skipped), `'fallback'` (the step failed for
 * good; `error` keeps the failure and the run continues at `next`) or `'timeout'` (a wait's
 * deadline passed with no event; the run continues at `next`).
 */
{
  readonly type: 'step.skipped';
  readonly step: string;
  readonly reason?: string;
  readonly next?: string | readonly string[];
  readonly error?: SerializedError$1;
  readonly kind?: StepFailureKind;
  readonly data?: unknown;
} |
/** The step's `when` predicate is being evaluated (it is ready; `apply` marks `when: 'pending'`). */
{
  readonly type: 'step.whenStarted';
  readonly step: string;
} |
/** `when` resolved — `ok: false` is followed by `step.skipped { reason: 'when' }`. */
{
  readonly type: 'step.whenEvaluated';
  readonly step: string;
  readonly ok: boolean;
} |
/** Explicit invalidation (never automatic). */
{
  readonly type: 'step.invalidated';
  readonly step: string;
  readonly cascade: boolean;
  readonly cause: 'command' | 'cascade';
} | {
  readonly type: 'step.cancelled';
  readonly step: string;
  readonly reason?: string;
} | {
  readonly type: 'step.validated';
  readonly step: string;
  readonly output: unknown;
} | {
  readonly type: 'step.validationFailed';
  readonly step: string;
  readonly issues: readonly Issue$2[];
} | {
  readonly type: 'step.guardEvaluated';
  readonly step: string;
  readonly hook: 'canEnter' | 'canExit';
  readonly ok: boolean;
  readonly reason?: string;
} |
/** The step's `idempotencyKey` hook is being called; `step.runStarted` follows. */
{
  readonly type: 'step.idempotencyKeyRequested';
  readonly step: string;
  readonly runId: number;
} | {
  readonly type: 'step.runStarted';
  readonly step: string;
  readonly attempt: number;
  readonly runId: number;
  readonly idempotencyKey: string;
  /** True when an idempotent run is re-issued after a crash/resume. */
  readonly resumed?: boolean;
} | {
  readonly type: 'step.runSucceeded';
  readonly step: string;
  readonly attempt: number;
  readonly output: unknown;
} |
/**
 * An attempt failed and the step's `mapError` hook is being called before the failure is
 * recorded (`step.runFailed { data }` follows). Carries the raw failure so `plan` can build the call.
 */
{
  readonly type: 'step.mapErrorStarted';
  readonly step: string;
  readonly attempt: number;
  readonly error: SerializedError$1;
  readonly timedOut?: boolean;
  readonly syncViolation?: boolean;
  readonly failureKind?: 'typed' | 'defect' | 'interrupted';
} |
/** `data` = the step's `mapError` value for this attempt's failure. */
{
  readonly type: 'step.runFailed';
  readonly step: string;
  readonly attempt: number;
  readonly error: SerializedError$1;
  readonly willRetry: boolean;
  readonly timedOut?: boolean;
  /** Failure channel from a run adapter; ordinary run functions leave this absent. */
  readonly failureKind?: 'typed' | 'defect' | 'interrupted';
  readonly data?: unknown;
} |
/** `dueAt` (not `at`, which is the envelope timestamp) = absolute time of the retry. */
{
  readonly type: 'step.retryScheduled';
  readonly step: string;
  readonly attempt: number;
  readonly dueAt: number;
  readonly timerId: string;
} |
/** `runId` identifies the stack entry (completion) being compensated — repeated activations have several. */
{
  readonly type: 'step.compensationStarted';
  readonly step: string;
  readonly runId?: number;
} | {
  readonly type: 'step.compensated';
  readonly step: string;
  readonly runId?: number;
} | {
  readonly type: 'step.compensationFailed';
  readonly step: string;
  readonly runId?: number;
  readonly error: SerializedError$1;
};
/**
 * Why a step failed for good (stored as `StepError.kind`). `guard`: its `needs` can never be
 * met (`DEPS_UNREACHABLE`).
 */
type StepFailureKind = 'run' | 'typed' | 'defect' | 'timeout' | 'hook' | 'guard' | 'child' | 'sync-violation' | 'interrupted';
type TransitionRejectReason = 'nav-busy' | 'not-a-view' | 'not-active' | 'not-reachable' | 'validation' | 'guard-canExit' | 'guard-canEnter' | 'no-target' | 'no-history' | 'flow-terminal' | 'flow-halted' | 'flow-not-started' | 'flow-compensating' | 'resumed' | 'auto-advance-loop';
//#endregion
//#region src/machine/each-events.d.ts
type EachEventBody = {
  readonly type: 'step.eachStarted';
  readonly step: string;
  readonly items: readonly unknown[];
  readonly keys: readonly string[];
} | {
  readonly type: 'step.eachItemStarted';
  readonly step: string;
  readonly index: number;
  readonly attempt: number;
  readonly resumed?: boolean;
} | {
  readonly type: 'step.eachItemKeyed';
  readonly step: string;
  readonly index: number;
  readonly key: string;
} | {
  readonly type: 'step.eachItemCompleted';
  readonly step: string;
  readonly index: number;
  readonly output?: unknown;
} | {
  readonly type: 'step.eachItemFailed';
  readonly step: string;
  readonly index: number;
  readonly attempt: number;
  readonly error: SerializedError$1;
  readonly willRetry: boolean;
  readonly kind?: StepFailureKind;
  readonly data?: unknown;
} | {
  readonly type: 'step.eachRetryScheduled';
  readonly step: string;
  readonly index: number;
  readonly attempt: number;
  readonly dueAt: number;
  readonly timerId: string;
} | {
  readonly type: 'step.eachRetryRequested';
  readonly step: string;
  readonly indices: readonly number[];
  readonly resetAttempts?: boolean;
} | {
  readonly type: 'step.eachChildStarted';
  readonly step: string;
  readonly index: number;
  readonly context: unknown;
} | {
  readonly type: 'step.eachChildSummary';
  readonly step: string;
  readonly index: number;
  readonly summary: ChildSummary$1;
} | {
  readonly type: 'step.eachChildOutputRequested';
  readonly step: string;
  readonly index: number;
  readonly output?: unknown;
} | {
  readonly type: 'step.eachMapErrorStarted';
  readonly step: string;
  readonly index: number;
  readonly attempt: number;
  readonly error: SerializedError$1;
  readonly timedOut?: boolean;
  readonly syncViolation?: boolean;
  readonly failureKind?: 'typed' | 'defect' | 'interrupted';
};
//#endregion
//#region src/machine/event-io.d.ts
type IoEventBody = {
  readonly type: 'input.changed';
  readonly step: string;
  readonly patch: unknown;
  readonly reset?: boolean;
} | {
  readonly type: 'context.changed';
  readonly patch: unknown;
  readonly by?: string;
} | {
  readonly type: 'event.received';
  readonly event: string;
  readonly payload: unknown;
  readonly correlationId?: string;
  readonly inboxId: string;
  /** The delivery's dedupe id (`send(…, { eventId })`), remembered in `state.eventIds`. */
  readonly eventId?: string;
} | {
  readonly type: 'event.rejected';
  readonly event: string;
  readonly issues: readonly Issue$2[];
} |
/** `payload` travels with the delivery so `plan` can build the `on` call from the event alone. */
{
  readonly type: 'event.delivered';
  readonly event: string;
  readonly to: string;
  readonly inboxId: string;
  readonly payload?: unknown;
} | {
  readonly type: 'event.buffered';
  readonly event: string;
  readonly inboxId: string;
  readonly expiresAt: number;
  readonly payload?: unknown;
} | {
  readonly type: 'event.expired';
  readonly event: string;
  readonly inboxId: string;
} |
/** `reason`: `'no-listener'`, or `'correlation'` (`correlate[event](payload)` ≠ the run's `correlationId`). */
{
  readonly type: 'event.dropped';
  readonly event: string;
  readonly reason: string;
} |
/** Delivered to the flow-level `on[event]` handler (`plan` → `call { hook: 'flowOn' }`), after step deliveries. */
{
  readonly type: 'event.flowDelivered';
  readonly event: string;
  readonly inboxId: string;
  readonly payload?: unknown;
} |
/**
 * A step handler returned something its kind cannot honour and it was ignored — `reason`:
 * `'kind'` (a passive handler returned a result it cannot use; a view returned
 * `keep`/`done`/`fail`) or `'nav-busy'` (a view returned `{ next }` while a transition was in flight).
 */
{
  readonly type: 'event.handlerResultIgnored';
  readonly step: string;
  readonly event: string;
  readonly reason: 'kind' | 'nav-busy';
} |
/**
 * An `on[event]` handler threw. Wait handlers fail their step instead; this is
 * recorded for every other kind (`step`) and for the flow-level handler (no `step`); nothing else changes.
 */
{
  readonly type: 'event.handlerFailed';
  readonly step?: string;
  readonly event: string;
  readonly error: SerializedError$1;
} |
/** `dueAt` = absolute fire time (`at` is the envelope timestamp). `step` is set for `retry` / `waitTimeout` timers (owner step). */
{
  readonly type: 'timer.scheduled';
  readonly timerId: string;
  readonly dueAt: number;
  readonly purpose: 'retry' | 'waitTimeout' | 'sleep' | 'inboxTtl' | 'compensationGrace';
  readonly step?: string;
} | {
  readonly type: 'timer.fired';
  readonly timerId: string;
} | {
  readonly type: 'timer.cleared';
  readonly timerId: string;
} |
/** `childPath` = the child's run path (`[...path, step]`; `path` is the envelope field). `context` = value returned by `childContext` (input for `child.create`). */
{
  readonly type: 'child.started';
  readonly step: string;
  readonly childPath: readonly string[];
  readonly context?: unknown;
} |
/** `done` mirrors `res.child.done` so `plan` can call `childOutput` / `apply` can store the child output. */
{
  readonly type: 'child.summary';
  readonly step: string;
  readonly summary: ChildSummary$1;
  readonly done?: {
    readonly output: unknown;
  };
} |
/** A `child` command was accepted and must be forwarded to the child interpreter (`plan` → `child.send`). */
{
  readonly type: 'child.command';
  readonly step: string;
  readonly itemIndex?: number;
  readonly command: Command$1;
} |
/** A hook called `progress(value)`: visible to `observe()`, mirrors and devtools only. */
{
  readonly type: 'step.progress';
  readonly step: string;
  readonly value: unknown;
} |
/**
 * An auto-save or `save()` could not be written: the snapshot is not JSON-serializable
 * (`reason: 'not-serializable'`, `location` = the offending path, e.g.
 * `state.steps.save.output.createdAt`) or the store rejected (`reason: 'store'`). The state
 * itself is unchanged; the envelope `seq` is the seq of the snapshot that failed to persist.
 */
{
  readonly type: 'persist.failed';
  readonly reason: 'not-serializable' | 'store';
  readonly key: string;
  readonly message: string;
  readonly location?: string;
} | {
  readonly type: 'command.rejected';
  readonly command: Command$1;
  readonly reason: string;
  readonly code: string;
} | {
  readonly type: 'result.ignored';
  readonly effectId: string;
  readonly reason: 'stale' | 'cancelled' | 'unknown-step';
};
//#endregion
//#region src/machine/events.d.ts
interface Envelope {
  /** Monotonic per run instance. */
  readonly seq: number;
  /** `clock.now()` when applied. */
  readonly at: number;
  /** Path of the run that produced the event: [] for the root, ['fulfil'] for a child. */
  readonly path: readonly string[];
  /** seq of the causing event, if any (effect results reference the event that planned the effect). */
  readonly causedBy?: number;
  /** Optional wall-clock duration for hook results. */
  readonly durationMs?: number;
}
type DomainEventBody = LifecycleEventBody | IoEventBody | EachEventBody;
type DomainEvent = Envelope & DomainEventBody;
type DomainEventType = DomainEventBody['type'];
/** Every event name emitted by a run. @public */
declare const RUN_EVENT_TYPES: readonly DomainEventType[];
//#endregion
//#region src/machine/explain.d.ts
interface Explanation$1 {
  readonly status: StepStatus$1 | 'unknown';
  readonly phase: StepPhase$1 | undefined;
  readonly reasons: readonly string[];
  readonly candidates: readonly string[];
}
//#endregion
//#region src/wizard/create-wizard/command.d.ts
/** Depth budget for typed child commands: `Prev[D]` = one child level deeper; `Prev[0]` = `never` = beyond. */
type CommandDepthPrev = [never, 0, 1, 2, 3, 4, 5, 6, 7];
/**
 * A `child` command with `string` ids: what typed child commands widen to for a wildcard flow
 * (`AnyFlow`) or beyond the depth budget.
 * @public
 */
interface AnyChildCommand {
  readonly type: 'child';
  readonly path: readonly [string, ...string[]];
  readonly command: Command<AnyFlow>;
}
/**
 * `setInput` correlated per view: `step: K` with `patch: DraftOf<F, K>`.
 * @public
 */
type SetInputCommand<F extends AnyFlow> = { [K in ViewId<F>]: {
  readonly type: 'setInput';
  readonly step: K;
  readonly patch: DraftOf<F, K>;
}; }[ViewId<F>];
type ChildPrefix<F extends AnyFlow, K extends ChildStepId<F>> = true extends IsEach<F, K> ? readonly [K, string] : readonly [K];
/**
 * A command addressed to a nested flow: `path: [flowStep]` with a `Command` of that child, or a
 * longer path (`[flowStep, grandChildStep, …]`) whose `command` is typed for the flow at its end
 * — the flattened form of nesting `child` commands. For a wildcard flow or beyond the depth
 * budget (8 child levels) it is `AnyChildCommand` (ids widen to `string`).
 * @public
 */
type ChildCommand<F extends AnyFlow, Depth extends number = 8> = [Depth] extends [never] ? AnyChildCommand : string extends ChildStepId<F> ? AnyChildCommand : { [K in ChildStepId<F>]: {
  readonly type: 'child';
  readonly path: ChildPrefix<F, K>;
  readonly command: Command<ChildFlowOf<F, K>, CommandDepthPrev[Depth]>;
} | (ChildCommand<ChildFlowOf<F, K>, CommandDepthPrev[Depth]> extends (infer Inner) ? Inner extends {
  readonly path: infer P extends readonly string[];
  readonly command: infer C;
} ? {
  readonly type: 'child';
  readonly path: readonly [...ChildPrefix<F, K>, ...P];
  readonly command: C;
} : never : never); }[ChildStepId<F>];
/**
 * A wire command (JSON), typed by the flow: `go` / `setInput` / `resetInput` take a `ViewId<F>`
 * (`setInput.patch` is that view's `DraftOf`), `run` / `retry` a `RunStepId<F>` (`retry.patch` a
 * context patch), `send` an `EventType<F>` (its `payload` stays `unknown` — it is re-parsed by
 * the event boundary; `eventId` dedupes deliveries),
 * `compensate.from` / `skip.step` / `invalidate.step` a `StepId<F>`, and `child` a typed
 * `ChildCommand<F>`. `Depth` bounds the child recursion (8 child levels; beyond it ids widen to
 * `string`). Untrusted input becomes a `Command<F>` through `parseCommand(flow, input)`;
 * `Command<AnyFlow>` is the untyped shape.
 * @public
 */
type Command<F extends AnyFlow = AnyFlow, Depth extends number = 8> = {
  readonly type: 'start';
} | {
  readonly type: 'next';
} | {
  readonly type: 'back';
} | {
  readonly type: 'go';
  readonly step: ViewId<F>;
  readonly reason?: string;
} | SetInputCommand<F> | {
  readonly type: 'resetInput';
  readonly step: ViewId<F>;
} | {
  readonly type: 'send';
  readonly event: EventType<F>;
  readonly payload: unknown;
  readonly correlationId?: string;
  readonly eventId?: string;
} | {
  readonly type: 'startStep';
  readonly step: RunStepId<F>;
} | {
  readonly type: 'startReady';
} | {
  readonly type: 'retry';
  readonly step: RetryStepId<F>;
  readonly patch?: Partial<Ctx<F>>;
} | {
  readonly type: 'cancel';
  readonly reason?: string;
} | {
  readonly type: 'compensate';
  readonly from?: StepId<F>;
  readonly reason?: string;
} | {
  readonly type: 'reset';
} | {
  readonly type: 'skip';
  readonly step: StepId<F>;
  readonly reason?: string;
} | {
  readonly type: 'invalidate';
  readonly step: StepId<F>;
  readonly cascade?: boolean;
} | ChildCommand<F, Depth>;
//#endregion
//#region src/wizard/create-wizard/state.d.ts
/**
 * A step's stored error typed by the step: `SerializedError` (`name`, `message`, `code?`) plus
 * `kind`, `at`, `attempt?`, `issues?` and — for a runnable step with `mapError` — `data` (`ErrorOf<F, K>`).
 * @public
 */
type StepErrorOf<F extends AnyFlow, K extends StepId<F>> = Omit<StepError$1, 'data'> & {
  readonly data?: ErrorOf<F, K>;
};
/**
 * Typed view of one step's stored record: `input` is the draft (`DraftOf`), `output` the
 * step's `OutputOf`, `error` its `StepErrorOf` (with `data` for `mapError`); everything
 * else (status, attempt, guards, timers…) is shared.
 * @public
 */
type StepState<F extends AnyFlow, K extends StepId<F>> = Omit<StepRecord, 'id' | 'kind' | 'input' | 'output' | 'error'> & {
  readonly id: K;
  readonly kind: KindOf<F, K>;
  readonly input?: DraftOf<F, K>;
  readonly output?: OutputOf<F, K>;
  readonly error?: StepErrorOf<F, K>;
};
/** Typed view of `WizardState`. */
type StateOf<F extends AnyFlow> = Omit<WizardState, 'current' | 'active' | 'context' | 'steps' | 'history' | 'failedStep' | 'output'> & {
  readonly current: ViewId<F> | null;
  readonly active: readonly StepId<F>[];
  readonly context: Ctx<F>;
  readonly steps: { readonly [K in StepId<F>]: StepState<F, K>; };
  readonly history: readonly ViewId<F>[];
  readonly failedStep?: StepId<F>;
  readonly output?: FlowOutput<F>;
};
/**
 * The versioned, JSON-safe snapshot of a run (what `getSnapshot()` returns, what a `Store`
 * persists and what `wizard.resume` accepts). `state` is the typed view of the run state;
 * `children` hold the snapshots of live child flows keyed by flow-step id.
 * @public
 */
type SnapshotDefinition<Types extends AnyFlow['~types']> = Omit<AnyFlow, '~types'> & {
  readonly '~types': Types;
};
/** Snapshot typing depends only on definition facts, so a wizard and its Flow have the same snapshot. @public */
type Snapshot<F extends AnyFlow> = SnapshotFields<SnapshotDefinition<F['~types']>>;
interface SnapshotFields<F extends AnyFlow> {
  readonly v: 1;
  readonly flow: {
    readonly name: string;
    readonly version: number;
  };
  readonly instanceId: string;
  readonly epoch: number;
  readonly seq: number;
  readonly savedAt: number;
  readonly state: StateOf<F>;
  readonly children: { readonly [K in ChildStepId<F>]?: Snapshot<ChildFlowOf<F, K>>; };
}
type RetypeStep<T, F extends AnyFlow> = T extends {
  readonly step: string;
} ? Omit<T, 'step'> & {
  readonly step: StepId<F>;
} : 'step' extends keyof T ? Omit<T, 'step'> & {
  readonly step?: StepId<F>;
} : T;
type RetypeEvent<T, F extends AnyFlow> = T extends {
  readonly event: string;
} ? Omit<T, 'event'> & {
  readonly event: EventType<F>;
} : T;
type StepOutputId<F extends AnyFlow> = string extends StepId<F> ? string : Exclude<StepId<F>, ViewId<F>>;
type StepOutputEvent<T, F extends AnyFlow, K extends StepOutputId<F> = StepOutputId<F>> = K extends unknown ? Omit<T, 'step' | 'output'> & {
  readonly step: K;
  readonly output?: OutputOf<F, K>;
} : never;
type RunOutputEvent<T, F extends AnyFlow, K extends RunStepId<F> = RunStepId<F>> = K extends unknown ? Omit<T, 'step' | 'output'> & {
  readonly step: K;
  readonly output: OutputOf<F, K>;
} : never;
type ViewOutputEvent<T, F extends AnyFlow, K extends ViewId<F> = ViewId<F>> = K extends unknown ? Omit<T, 'step' | 'output'> & {
  readonly step: K;
  readonly output: OutputOf<F, K>;
} : never;
type StepErrorEvent<T, F extends AnyFlow, K extends StepId<F> = StepId<F>> = K extends unknown ? Omit<T, 'step' | 'data'> & {
  readonly step: K;
  readonly data?: ErrorOf<F, K>;
} : never;
type RunErrorEvent<T, F extends AnyFlow, K extends RunStepId<F> = RunStepId<F>> = K extends unknown ? Omit<T, 'step' | 'data'> & {
  readonly step: K;
  readonly data?: ErrorOf<F, K>;
} : never;
type RunStepEvent<T, F extends AnyFlow, K extends RunStepId<F> = RunStepId<F>> = K extends unknown ? Omit<T, 'step'> & {
  readonly step: K;
} : never;
type FlowFailedEvent<T, F extends AnyFlow, K extends StepId<F> = StepId<F>> = (K extends unknown ? Omit<T, 'step' | 'data'> & {
  readonly step: K;
  readonly data?: ErrorOf<F, K>;
} : never) | (Omit<T, 'step'> & {
  readonly step?: never;
});
type EventPayloadEvent<T, F extends AnyFlow, Optional extends boolean, E extends EventType<F> = EventType<F>> = E extends unknown ? Omit<T, 'event' | 'payload'> & {
  readonly event: E;
} & (Optional extends true ? {
  readonly payload?: PayloadOf<F, E>;
} : {
  readonly payload: PayloadOf<F, E>;
}) : never;
type InputChangedEvent<T, F extends AnyFlow, K extends ViewId<F> = ViewId<F>> = K extends unknown ? Omit<T, 'step'> & {
  readonly step: K;
} : never;
type ChildStartedEvent<T, F extends AnyFlow, P extends readonly string[], K extends ChildStepId<F> = ChildStepId<F>> = K extends unknown ? Omit<T, 'step' | 'childPath' | 'context'> & {
  readonly step: K;
  readonly childPath: readonly [...P, K];
  readonly context: ContextInput<ChildFlowOf<F, K>>;
} : never;
type ChildSummaryEvent<T, F extends AnyFlow, K extends ChildStepId<F> = ChildStepId<F>> = K extends unknown ? Omit<T, 'step' | 'done' | 'summary'> & {
  readonly step: K;
  readonly summary: Omit<ChildSummary$1, 'current'> & {
    readonly current: ViewId<ChildFlowOf<F, K>> | null;
  };
  readonly done?: {
    readonly output: FlowOutput<ChildFlowOf<F, K>>;
  };
} : never;
type ChildCommandEvent<T, F extends AnyFlow, K extends ChildStepId<F> = ChildStepId<F>> = K extends unknown ? Omit<T, 'step' | 'command'> & {
  readonly step: K;
  readonly command: Command<ChildFlowOf<F, K>>;
} : never;
type TypedFlowEvent<T, F extends AnyFlow, P extends readonly string[]> = T extends {
  readonly type: 'flow.done';
} ? Omit<T, 'output'> & {
  readonly output?: FlowOutput<F>;
} : T extends {
  readonly type: 'flow.failed';
} ? FlowFailedEvent<T, F> : T extends {
  readonly type: 'step.done';
} ? StepOutputEvent<T, F> : T extends {
  readonly type: 'step.runSucceeded';
} ? RunOutputEvent<T, F> : T extends {
  readonly type: 'step.validated';
} ? ViewOutputEvent<T, F> : T extends {
  readonly type: 'step.failed';
} ? StepErrorEvent<T, F> : T extends {
  readonly type: 'step.runFailed';
} ? RunErrorEvent<T, F> : T extends {
  readonly type: 'step.idempotencyKeyRequested' | 'step.mapErrorStarted' | 'step.retryScheduled' | 'step.runStarted';
} ? RunStepEvent<T, F> : T extends {
  readonly type: 'input.changed';
} ? InputChangedEvent<T, F> : T extends {
  readonly type: 'context.changed';
} ? Omit<T, 'patch'> & {
  readonly patch: Partial<Ctx<F>>;
} : T extends {
  readonly type: 'event.buffered' | 'event.delivered' | 'event.flowDelivered' | 'event.received';
} ? EventPayloadEvent<T, F, false> : T extends {
  readonly type: 'child.started';
} ? ChildStartedEvent<T, F, P> : T extends {
  readonly type: 'child.summary';
} ? ChildSummaryEvent<T, F> : T extends {
  readonly type: 'child.command';
} ? ChildCommandEvent<T, F> : T extends {
  readonly type: 'command.rejected';
} ? Omit<T, 'command'> & {
  readonly command: Command<F>;
} : RetypeEvent<RetypeStep<T, F>, F>;
type WithPath<T, P extends readonly string[]> = T extends unknown ? Omit<T, 'path'> & {
  readonly path: P;
} : never;
type FlowEventAtPath<F extends AnyFlow, P extends readonly string[]> = WithPath<TypedFlowEvent<DomainEvent, F, P>, P>;
type RunEventDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type PreviousRunEventDepth = [0, 0, 1, 2, 3, 4, 5, 6, 7];
type UntypedChildRunEvent<P extends readonly string[]> = WithPath<DomainEvent, readonly [...P, string, ...string[]]>;
type ChildPath<F extends AnyFlow, K extends ChildStepId<F>, P extends readonly string[]> = true extends IsEach<F, K> ? readonly [...P, K, `${number}`] : readonly [...P, K];
type ChildRunEventCandidates<F extends AnyFlow, P extends readonly string[], Depth extends RunEventDepth> = Depth extends 0 ? never : string extends ChildStepId<F> ? UntypedChildRunEvent<P> : { [K in ChildStepId<F>]: FlowEventAtPath<ChildFlowOf<F, K>, ChildPath<F, K, P>> | ChildRunEventAt<ChildFlowOf<F, K>, ChildPath<F, K, P>, PreviousRunEventDepth[Depth]>; }[ChildStepId<F>];
type ChildRunEventAt<F extends AnyFlow, P extends readonly string[], Depth extends RunEventDepth> = ChildRunEventCandidates<F, P, Depth> extends (infer Event extends DomainEvent) ? Event : never;
/**
 * A domain event of the run's OWN flow (`path` is `[]`), typed by the flow: `step` is a
 * `StepId<F>`, `event` an `EventType<F>`.
 * @public
 */
type RootRunEvent<F extends AnyFlow = AnyFlow> = FlowEventAtPath<F, readonly []>;
/**
 * A domain event forwarded from a child flow (`path.length > 0`). `path` identifies the child
 * flow that emitted it; step ids, event names and payloads come from that flow. Typing follows
 * nested flows to the runtime's maximum depth of eight. `AnyFlow` keeps string ids and unknown
 * payloads. Narrow a `RunEvent<F>` with `isChildEvent(event)`.
 * @public
 */
type ChildRunEvent<F extends AnyFlow = AnyFlow> = ChildRunEventAt<F, readonly [], 8>;
/**
 * A domain event of a run (`observe()` / `log()`): either an event of its own flow, typed by
 * `F` (`RootRunEvent<F>`, `path: []`), or one forwarded from a child flow
 * (`ChildRunEvent<F>`, `path: [step, …]`). TypeScript does not narrow on
 * `event.path.length`; use `isChildEvent(event)` to split the two.
 * @public
 */
type RunEvent<F extends AnyFlow = AnyFlow> = RootRunEvent<F> | ChildRunEvent<F>;
/** Name of any event emitted by an OpenWizard run. @public */
type RunEventType = DomainEvent['type'];
/**
 * True for events forwarded from a child flow (`event.path.length > 0`); narrows a
 * `RunEvent<F>` to `ChildRunEvent<F>` (and, in the other branch, to `RootRunEvent<F>`).
 * @public
 */
declare function isChildEvent<F extends AnyFlow>(event: RunEvent<F>): event is ChildRunEvent<F>;
/**
 * Result of `run.explain(step)`: the step's stored `status` (`'unknown'` for an unknown id),
 * its live `phase` (`undefined` when it has none), stable `reasons` codes explaining why it is
 * (not) where you expect (`flow-not-started`, `nav-busy`, `not-activated`, `deps-unmet:<id>`,
 * `guard-false:canEnter`, `concurrency-limit`, `auto-run-manual`, `failed:<kind>`,
 * `not-current`, `entering`, `retrying`, …), the ready views the cursor could move to, and
 * what the run waits on from the outside (`run.waitingFor()`).
 * @public
 */
type Explanation<F extends AnyFlow = AnyFlow> = Omit<Explanation$1, 'candidates'> & {
  readonly candidates: readonly ViewId<F>[];
  readonly waitingFor: readonly WaitingFor<F>[];
};
//#endregion
//#region src/wizard/results.d.ts
/**
 * Result of `dispatch()` and of every non-navigation command method (`start`, `setInput`, `retry`, …).
 *
 * @public
 */
type CommandResult = {
  readonly ok: true;
  readonly seq: number;
} | {
  readonly ok: false;
  readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING' | 'FORBIDDEN';
  readonly message: string;
  readonly step?: string;
  readonly issues?: readonly Issue$2[];
};
/**
 * Result of the navigation methods `next()`, `back()` and `go()`.
 *
 * @public
 */
type NavResult = {
  readonly ok: true;
  readonly from: string | null;
  readonly to: string | null;
  readonly seq: number;
} | {
  readonly ok: false;
  readonly reason: TransitionRejectReason;
  readonly code: WizardErrorCode;
  readonly message: string;
  readonly step?: string;
  readonly issues?: readonly Issue$2[];
} |
/**
 * The transition was accepted but a hook threw (`transition.failed`), or the
 * run was disposed while the transition was in flight (`code: 'DISPOSED'`).
 */
{
  readonly ok: false;
  readonly reason: 'failed';
  readonly code: WizardErrorCode | 'HOOK_FAILED' | 'STALE';
  readonly message: string;
  readonly step?: string;
  readonly error?: SerializedError$1;
};
/**
 * Result of `send(event, payload, options)`: delivered/buffered, a duplicate (`duplicate: true`:
 * the `eventId` was already delivered, nothing changed, `delivered` is empty), rejected by the event boundary
 * (`code: 'BOUNDARY_REJECTED'`, with the boundary's `issues`), or dropped — nothing was waiting
 * for the event and it was not buffered (`code: 'NOT_ACTIVE'`), the machine refused it
 * (`FLOW_TERMINAL` / `FLOW_NOT_STARTED` / `FLOW_COMPENSATING`, …) or the run was disposed
 * (`DISPOSED`). Every `{ ok: false }` result carries `code` + `message`, like `CommandResult`;
 * `dispatch({ type: 'send' })` returns the same `code` as a `CommandResult`.
 *
 * @public
 */
type SendResult = {
  readonly ok: true;
  readonly delivered: readonly string[];
  readonly buffered: boolean;
  readonly duplicate?: true;
  readonly seq: number;
} | {
  readonly ok: false;
  readonly reason: 'rejected';
  readonly code: 'BOUNDARY_REJECTED';
  readonly message: string;
  readonly issues: readonly Issue$2[];
} | {
  readonly ok: false;
  readonly reason: 'dropped';
  readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING';
  readonly message: string;
};
/** A compensation-hook failure. Its error is serialized because compensation has no `mapError`.
 * @public
 */
type CompensationFailure<F extends AnyFlow> = { readonly [K in RunStepId<F>]: {
  readonly step: K;
  readonly runId: number;
  readonly error: SerializedError$1;
}; }[RunStepId<F>];
/** Compensation facts retained on a failed or cancelled terminal result: `'partial'` when at
 * least one compensation hook failed (`failures` is non-empty), else `'completed'`.
 * @public
 */
interface CompensationSummary<F extends AnyFlow> {
  readonly outcome: 'completed' | 'partial';
  readonly failures: readonly CompensationFailure<F>[];
}
/** A failure attributed to one flow step; `error.data` is present only for a mapped run error.
 * @public
 */
type StepFailure<F extends AnyFlow> = { readonly [K in StepId<F>]: {
  readonly kind: 'step';
  readonly step: K;
  readonly error: StepErrorOf<F, K>;
  readonly compensation?: CompensationSummary<F>;
  /**
   * For a flow step: the child's terminal result when it was retained, or — when a halted
   * child halted this run — the child's own halted outcome (recover it through `run.child(step)`).
   */
  readonly child?: [ChildFlowOf<F, K>] extends [never] ? never : RunResult<ChildFlowOf<F, K>> | RunHalted<ChildFlowOf<F, K>>;
}; }[StepId<F>];
/** The typed failure channel of a terminal run. Unknown thrown values remain serialized/runtime data.
 * @public
 */
type FlowFailure<F extends AnyFlow> = StepFailure<F> | {
  readonly kind: 'compensation';
  readonly cause?: StepFailure<F>;
  readonly compensation: CompensationSummary<F> & {
    readonly outcome: 'partial';
  };
} | {
  readonly kind: 'cancelled';
  readonly reason?: string;
  readonly compensation?: CompensationSummary<F>;
} | {
  readonly kind: 'runtime';
  readonly step?: StepId<F>;
  readonly error: SerializedError$1;
};
/** Successful terminal result.
 * @public
 */
interface RunDone<F extends AnyFlow> {
  readonly status: 'done';
  readonly output: FlowOutput<F>;
  readonly seq: number;
  readonly epoch: number;
}
/** Failed terminal result: nothing can recover the run (a recoverable halt is `RunHalted`).
 * @public
 */
interface RunFailed<F extends AnyFlow> {
  readonly status: 'failed';
  readonly failure: Exclude<FlowFailure<F>, {
    readonly kind: 'cancelled';
  }>;
  readonly seq: number;
  readonly epoch: number;
}
/** Cancellation is separate from a failed run, including when compensation was attempted.
 * @public
 */
interface RunCancelled<F extends AnyFlow> {
  readonly status: 'cancelled';
  readonly failure: Extract<FlowFailure<F>, {
    readonly kind: 'cancelled';
  }>;
  readonly seq: number;
  readonly epoch: number;
}
/** One-shot terminal outcome of a `Run`.
 * @public
 */
type RunResult<F extends AnyFlow> = RunDone<F> | RunFailed<F> | RunCancelled<F>;
type WaitEntry<Path, Step, View, Event> = {
  readonly kind: 'view';
  readonly path: Path;
  readonly step: View;
} | {
  readonly kind: 'event';
  readonly path: Path;
  readonly step: Step;
  readonly events: readonly Event[];
  /** Absolute time (ms) the wait times out, when it declares a timeout. */
  readonly deadline?: number;
} | {
  readonly kind: 'sleep';
  readonly path: Path;
  readonly step: Step;
  readonly deadline: number;
};
/**
 * One thing a run waits on from the outside: a user on a `view`, an external `event` (with the
 * absolute `deadline` of its timeout), or a `sleep` that fires at `deadline`. The list is flat:
 * `path` locates the run — `[]` is this run (ids and event names typed by `F`), `['pay']` the
 * child run of flow step `pay`, or `['pay', '0']` its first mapped item (child ids untyped).
 * @public
 */
type WaitingFor<F extends AnyFlow> = WaitEntry<readonly [], StepId<F>, ViewId<F>, EventType<F>> | ([ChildStepId<F>] extends [never] ? never : WaitEntry<readonly [string, ...string[]], string, string, string>);
/**
 * A run stopped by a failed step under `onFailure: 'halt'`, or by a halted child flow
 * (`failure.child` is the child's halted outcome): recover it with `retry` / `skip` /
 * `compensate` / `cancel` (on `run.child(step)` for a child), or persist `snapshot` and `resume`
 * it later.
 * @public
 */
interface RunHalted<F extends AnyFlow> {
  readonly status: 'halted';
  readonly failure: StepFailure<F>;
  readonly snapshot: Snapshot<F>;
  readonly seq: number;
  readonly epoch: number;
}
/**
 * A run parked on a view or an external event: `waitingFor` lists every wait (sleeps included),
 * empty only when the run is stuck (nothing runs and nothing waits). Persist `snapshot` and
 * `resume` it when the input arrives.
 * @public
 */
interface RunWaiting<F extends AnyFlow> {
  readonly status: 'waiting';
  readonly waitingFor: readonly WaitingFor<F>[];
  readonly snapshot: Snapshot<F>;
  readonly seq: number;
  readonly epoch: number;
}
/**
 * What `run.awaitOutcome()`, `wizard.run()` and `wizard.runSync()` return: a terminal
 * `RunResult`, or the run halted or waiting — never a hang, never a throw for a failed step.
 * @public
 */
type RunOutcome<F extends AnyFlow> = RunResult<F> | RunHalted<F> | RunWaiting<F>;
/** Why a lifecycle-sensitive waiter ended before producing its normal result.
 * @public
 */
type RunLifecycleCode = 'RUN_RESET' | 'RUN_DISPOSED';
/**
 * Rejection from a lifecycle-sensitive wait. `awaitResult()` rejects on reset or disposal;
 * `whenIdle()` rejects on disposal. This is intentionally separate from `RunResult`.
 *
 * @public
 */
declare class RunLifecycleError extends Error {
  readonly code: RunLifecycleCode;
  readonly reason: 'reset' | 'disposed';
  constructor(code: RunLifecycleCode, message?: string);
}
//#endregion
//#region src/wizard/runtime/types.d.ts
/**
 * §9.5: rewrite a snapshot persisted by an older flow version. Called only when the
 * snapshot's `flow.version` differs from the flow's (a `flow.name` mismatch is always
 * incompatible); the result is stamped with the flow's current version and validated like any
 * snapshot (`renameSteps` rewrites renamed step ids). May return a promise — then only
 * `wizard.resumeAsync` accepts it.
 */
type SnapshotMigration$1 = (snapshot: unknown, from: {
  readonly name: string;
  readonly version: number;
}) => unknown;
/** `send()` options: correlation and event deduplication. @public */
interface SendOptions {
  readonly correlationId?: string;
  readonly eventId?: string;
}
/** Optimistic concurrency checked atomically when dispatch reaches the machine. @public */
interface DispatchOptions {
  readonly expectedVersion?: {
    readonly epoch: number;
    readonly seq: number;
  };
}
//#endregion
//#region src/projection/define-projection.d.ts
/**
 * Live phase of a step as seen by UIs (`blocked | ready | entering | validating | running |
 * retrying | waiting | exiting | compensating`); absent when the step has no live phase.
 * @public
 */
type StepPhase = StepPhase$1;
/**
 * Compact status of a child flow as stored on the parent's flow step (`status`, `current`,
 * `progress` 0..1, `seq`) — what `child: true` exposes.
 * @public
 */
type ChildSummary = ChildSummary$1;
/**
 * Exposure of one step: its draft `input`, its `output`, its validation `issues`, its sanitized
 * `error` (with the `mapError` `data`), its hook `progress(value)` events (`progress: true`:
 * forwarded to mirrors as transient progress frames, `mirror.observe()`; never in the state), and
 * — flow steps only — `child`: `true` for the compact `ChildSummary`, or a nested
 * spec for projected child state. Mapped children use arrays in input order, with `null` for
 * children not created yet. Nothing is exposed by default.
 * @public
 */
type StepExpose<F extends AnyFlow, K extends StepId<F>> = {
  readonly input?: boolean;
  readonly output?: boolean;
  readonly issues?: boolean;
  readonly error?: boolean;
  readonly progress?: boolean;
} & ([ChildFlowOf<F, K>] extends [never] ? {} : {
  readonly child?: boolean | ExposeSpec<ChildFlowOf<F, K>>;
});
/**
 * What a projection exposes: per-step flags, the context keys that cross the wire, whether the
 * flow `output` does (`output: true`) and whether the `progress` summary (`{ done, total,
 * ratio }`) does (`progress: true`; a step's hook progress events need its own `progress: true`).
 * @public
 */
interface ExposeSpec<F extends AnyFlow> {
  readonly steps?: { readonly [K in StepId<F>]?: StepExpose<F, K>; };
  readonly context?: readonly (keyof Ctx<F> & string)[];
  readonly output?: boolean;
  readonly progress?: boolean;
  /** Flat waits, with paths relative to the projected run. */
  readonly waitingFor?: boolean;
}
/**
 * Transient progress selected by step. `true` exposes that step's own progress events; a child
 * wizard's events require its own nested `child` map. This does not add fields to projected state.
 * @public
 */
type ProgressSpec<F extends AnyFlow> = { readonly [K in StepId<F>]?: boolean | ({
  readonly progress?: boolean;
} & ([ChildFlowOf<F, K>] extends [never] ? {
  readonly child?: never;
} : {
  readonly child?: ProgressSpec<ChildFlowOf<F, K>>;
})); };
/** Depth budget: `Prev[D]` = one child edge deeper; `Prev[0]` = `never` = beyond the budget. */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];
type StepExposeOf<E, K extends PropertyKey> = E extends {
  readonly steps: infer S;
} ? K extends keyof S ? S[K] : undefined : undefined;
type ExposedContextKeys<F extends AnyFlow, E> = E extends {
  readonly context: readonly (infer CK)[];
} ? Extract<CK, keyof Ctx<F>> : never;
/**
 * Placeholder type once nesting exceeds the depth budget (8 child levels below the root).
 * @public
 */
interface ClientStateFallback {
  readonly '~depth': 'exceeded';
}
/**
 * A step error as a projection exposes it (`error: true`): `{ name, message, code? }` — never a
 * stack — plus `data`, the runnable step's `mapError` value (`ErrorOf<F, K>`), when present.
 * @public
 */
interface ClientStepError<E> extends SerializedError {
  readonly data?: E;
}
type ClientChild<F extends AnyFlow, K extends StepId<F>, S> = boolean extends IsEach<F, K> ? S | readonly (S | null)[] : true extends IsEach<F, K> ? readonly (S | null)[] : S;
/**
 * Projected state of one step: base facts (`id`, `kind`, `status`, `phase`, `attempt`) plus
 * `input` / `output` / `issues` / `error` / `child` exactly where exposed. `Depth` is the number
 * of child levels still allowed below this step.
 * @public
 */
type ClientStepState<F extends AnyFlow, K extends StepId<F>, SE, Depth extends number> = {
  readonly id: K;
  readonly kind: KindOf<F, K>;
  readonly status: StepStatus;
  readonly phase?: StepPhase;
  readonly attempt: number;
} & ([SE] extends [{
  readonly input: true;
}] ? {
  readonly input?: DraftOf<F, K>;
} : {}) & ([SE] extends [{
  readonly output: true;
}] ? {
  readonly output?: OutputOf<F, K>;
} : {}) & ([SE] extends [{
  readonly issues: true;
}] ? {
  readonly issues?: readonly Issue$1[];
} : {}) & ([SE] extends [{
  readonly error: true;
}] ? {
  readonly error?: ClientStepError<ErrorOf<F, K>>;
} : {}) & ([SE] extends [{
  readonly child: true;
}] ? {
  readonly child?: ClientChild<F, K, ChildSummary>;
} : SE extends {
  readonly child: infer CE extends object;
} ? {
  readonly child?: ClientChild<F, K, ClientState<ChildFlowOf<F, K>, CE, Depth>>;
} : {});
/**
 * The projected (client-safe) state of a run for exposure spec `E`. `Depth` counts the child
 * edges still allowed: 8 real child levels below the root are typed precisely, deeper ones are
 * `ClientStateFallback`. The flow `output` is present only with `expose.output: true`,
 * `progress` only with `expose.progress: true`.
 * @public
 */
type ClientState<F extends AnyFlow, E, Depth extends number = 8> = [Depth] extends [never] ? ClientStateFallback : {
  readonly instanceId: string;
  readonly epoch: number;
  readonly seq: number;
  readonly status: RunStatus;
  readonly current: ViewId<F> | null;
  readonly context: Pick<Ctx<F>, ExposedContextKeys<F, E>>;
  readonly steps: { readonly [K in StepId<F>]: ClientStepState<F, K, StepExposeOf<E, K>, Prev[Depth]>; };
} & ([E] extends [{
  readonly output: true;
}] ? {
  readonly output?: FlowOutput<F>;
} : {}) & ([E] extends [{
  readonly progress: true;
}] ? {
  readonly progress: Progress;
} : {}) & ([E] extends [{
  readonly waitingFor: true;
}] ? {
  readonly waitingFor: readonly WaitingFor<F>[];
} : {});
/**
 * A `select` projection's mapper: from the typed run state to the projected value.
 * @public
 */
type ProjectionSelect<F extends AnyFlow, S, Scope = never> = [Scope] extends [never] ? (state: Snapshot<F>['state']) => S : (input: {
  readonly state: Snapshot<F>['state'];
  readonly scope: Scope;
}) => S;
/**
 * A projection of flow `F` producing the client state type `S` — either deny-by-default
 * (`expose`, `S = ClientState<F, E>`) or arbitrary (`select`, `S` = its return type). The
 * `Flow` object it belongs to is compared by identity; `S` is what Mirror frames carry
 * (`ProjectionOutput<P>`).
 * @public
 */
interface Projection<F extends AnyFlow, S, Scope = never> {
  readonly '~types': {
    readonly flow: F;
    readonly state: S;
    readonly scope: Scope;
  } | undefined;
  /** The authored source wizard. Provided variants share its identity; separately authored definitions do not. */
  readonly flow: F;
  /** The exposure spec (deny-by-default projections); `undefined` for a `select` projection. */
  readonly expose: ExposeSpec<F> | undefined;
  /** Per-step transient progress allowed by a `select` projection; absent means no events. */
  readonly progress: ProgressSpec<F> | undefined;
  /** Principal boundary for a scoped `select`; `undefined` for unscoped projections. */
  readonly scope: [Scope] extends [never] ? undefined : Boundary<Scope, Scope>;
  /** The mapper (`select` projections); `undefined` for an `expose` projection. */
  readonly select: ProjectionSelect<F, S, Scope> | undefined;
}
/**
 * Any projection (the constraint of `ProjectionOutput`, `Mirror`, the React binding): the
 * phantom facts every `Projection<F, S>` carries.
 * @public
 */
interface AnyProjection {
  readonly '~types': {
    readonly flow: AnyFlow;
    readonly state: unknown;
    readonly scope: unknown;
  } | undefined;
  readonly flow: AnyFlow;
}
/**
 * The flow type a projection was defined for.
 * @public
 */
type ProjectionFlow<P extends AnyProjection> = NonNullable<P['~types']>['flow'];
/**
 * The projected state type of a projection (`ClientState` of its flow for its exposure spec, or
 * the `select` mapper's return type).
 * @public
 */
type ProjectionOutput<P extends AnyProjection> = NonNullable<P['~types']>['state'];
/** The principal type required by a scoped projection, or `never` when it is unscoped.
 * @public
 */
type ProjectionScope<P extends AnyProjection> = NonNullable<P['~types']>['scope'];
/**
 * Define a projection of a wizard. `{ expose }` returns only the selected fields and base facts.
 * `{ select }` returns its mapper's result, and `progress` separately allows transient step events.
 * The two state definitions are mutually exclusive.
 * @public
 */
declare function defineProjection<F extends AnyFlow, const E extends ExposeSpec<F> = never, S = unknown, Scope = never>(wizard: F, options: {
  readonly expose: E;
  readonly scope?: never;
  readonly select?: undefined;
  readonly progress?: never;
} | {
  readonly expose?: undefined;
  readonly scope?: Boundary<Scope, Scope>;
  readonly select: ProjectionSelect<F, S, Scope>;
  readonly progress?: ProgressSpec<F>;
}): Projection<F, [E] extends [never] ? S : ClientState<F, E>, Scope>;
//#endregion
//#region src/projection/definition.d.ts
/** State facts shared by a wizard and its provided variants.
 * @public
 */
type ProjectionDefinition<F extends AnyFlow> = Omit<AnyFlow, '~types'> & {
  readonly '~types': (Omit<TypesOf<F>, 'provided'> & {
    readonly provided: PropertyKey;
  }) | undefined;
};
//#endregion
//#region src/wizard/create-wizard/wizard.d.ts
/**
 * A live run instance, typed by its flow. Navigation returns `NavResult`, everything else a
 * `CommandResult` / `SendResult`; nothing throws for data problems.
 * @public
 */
interface Run<F extends AnyFlow> {
  /** Instance id (also the default store key). */
  readonly id: string;
  /** Increments on every resume. */
  readonly epoch: number;
  /** The flow definition this instance runs. */
  readonly flow: F;
  /** Activate the `start` step(s). */
  start(): Promise<CommandResult>;
  next(): Promise<NavResult>;
  back(): Promise<NavResult>;
  go(step: ViewId<F>): Promise<NavResult>;
  /** Shallow-merge a draft patch into a view's input (parsed on `next`/`go`). */
  setInput<K extends ViewId<F>>(step: K, patch: DraftOf<F, K>): Promise<CommandResult>;
  resetInput(step: ViewId<F>): Promise<CommandResult>;
  /** Pure query: the view's `input` boundary + `validate` hook over the current draft. */
  validate(step: ViewId<F>): Promise<readonly Issue$1[]>;
  /**
   * External event through the flow's event boundary. A typed payload must match the event's
   * schema input; an `unknown` body (a request) is accepted and parsed by the boundary. With an
   * `eventId`, a delivery the run still remembers (`RunOptions.eventIds`) is a duplicate:
   * `{ ok: true, duplicate: true, delivered: [] }` and nothing changes.
   */
  send<E extends EventType<F>, P>(event: E, payload: unknown extends P ? P : PayloadInput<F, E>, options?: {
    readonly correlationId?: string;
    readonly eventId?: string;
  }): Promise<SendResult>;
  /** Run one ready runnable step now (`autoRun: 'manual'`). */
  startStep(step: RunStepId<F>): Promise<CommandResult>;
  /** Re-run a failed runnable step (`attempt` resets); `patch` is merged into the context first. */
  retry(step: RetryStepId<F>, options?: {
    readonly patch?: Partial<Ctx<F>>;
  }): Promise<CommandResult>;
  cancel(reason?: string): Promise<CommandResult>;
  /** Start ready non-view steps when `autoRun: 'manual'`. */
  startReady(): Promise<CommandResult>;
  compensate(options?: {
    readonly from?: StepId<F>;
    readonly reason?: string;
  }): Promise<CommandResult>;
  /** Back to the initial state (`flow.reset`): steps idle, timers cleared, children disposed; the instance id stays. */
  reset(): Promise<CommandResult>;
  /**
   * Skip a ready or active non-completing step explicitly: it has no output, so a step with a
   * plain need on it is skipped too and an optional need reads `undefined`; its `next` targets
   * are arrived; an active run is cancelled first; a view must be ready or current (the current
   * view exits without validation).
   */
  skip(step: StepId<F>, reason?: string): Promise<CommandResult>;
  /**
   * Return a `done` / `failed` / `skipped` step to `idle` (`step.invalidated`): a view keeps its
   * draft, the output moves to `previousOutput`, and with `cascade` (default `true`) every
   * transitive `needs` dependent that is done / failed / skipped follows (running ones are
   * cancelled). Never automatic; rejected for an active step or the current view (`INVALID_COMMAND`).
   */
  invalidate(step: StepId<F>, options?: {
    readonly cascade?: boolean;
  }): Promise<CommandResult>;
  /**
   * The one wire door, typed by the flow (`Command<F>`); never throws for data problems.
   * Untrusted input goes through `parseCommand(flow, input)` first. `expectedVersion` is
   * checked atomically after payload parsing, immediately before the command is applied.
   */
  dispatch(command: Command<F>, options?: DispatchOptions): Promise<CommandResult>;
  /**
   * Hook an external event source (a queue consumer, an `EventTarget`, a socket) to `send`:
   * `source` receives the run's typed `send` and returns its own teardown, which runs when
   * the returned function is called or when the run is disposed. After `dispose()` the source is
   * never called and the returned function does nothing.
   */
  attach(source: (send: Run<F>['send']) => () => void): () => void;
  getState(): Snapshot<F>['state'];
  /** The terminal result, or `undefined` while the run is not terminal. */
  result(): RunResult<F> | undefined;
  /** Wait for the terminal result; reset/dispose rejects with `RunLifecycleError`. */
  awaitResult(): Promise<RunResult<F>>;
  /**
   * Wait for the next state that needs the outside world: terminal, halted, or waiting on a view
   * or an external event (sleeps and retry backoff keep it waiting). Does not dispose the run;
   * disposal rejects with `RunLifecycleError('RUN_DISPOSED')`.
   */
  awaitOutcome(): Promise<RunOutcome<F>>;
  /** Pure query: what the run and its live children wait on from the outside (flat, by `path`). */
  waitingFor(): readonly WaitingFor<F>[];
  /**
   * Wait for the current FIFO drain, its synchronous follow-up batches, and each host
   * `beforeEffects` barrier. Future timers and unfinished asynchronous run hooks do not block it.
   * Disposal rejects with `RunLifecycleError('RUN_DISPOSED')`.
   */
  whenIdle(): Promise<void>;
  /** Subscribe to terminal transitions; a reset starts a new subscription cycle. */
  subscribeResult(listener: (result: RunResult<F>) => void): () => void;
  /** Versioned, JSON-safe snapshot including live children; cached per state. */
  getSnapshot(): Snapshot<F>;
  /**
   * Pure query: why a step is (not) where you expect — status, live phase, stable reason codes
   * and the ready views the cursor could move to. Never throws (an unknown id yields
   * `status: 'unknown'`); safe to call after `dispose()`.
   */
  explain(step: StepId<F>): Explanation<F>;
  /** Pure query over steps that do not complete the flow (`skipped` counts as done). */
  progress(): Progress;
  /** Pure query: the views that are ready or current (where the cursor is or could go). */
  readyViews(): readonly ViewId<F>[];
  /** State listeners: once per committed batch. */
  subscribe(listener: (state: Snapshot<F>['state']) => void): () => void;
  /** Event listeners: every event of this run and its children (`event.path`). */
  observe(listener: (event: RunEvent<F>) => void): () => void;
  /** Bounded event ring (default 200). */
  log(): readonly RunEvent<F>[];
  /**
   * Live nested run of a `flow` step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`). After `dispose()`
   * it returns the child that was live then, disposed too. Mapped children require an item
   * selector: a number is the input index, a string is the stable item key.
   */
  child<K extends ChildStepId<F>>(step: K, ...selector: true extends IsEach<F, K> ? [keyOrIndex: number | string] : [keyOrIndex?: never]): Run<ChildFlowOf<F, K>>;
  /**
   * Client-safe state through a projection defined for this authored wizard or a provided variant — a deny-by-default
   * `expose` projection (`ClientState<F, E>`) or a `select` projection (its return type). A scoped
   * projection requires its principal as the second argument. A projection for any other flow
   * definition throws `WizardError('DEFINITION_INVALID')`.
   */
  project<S, Scope = never>(projection: Projection<F, S, Scope> | Projection<ProjectionDefinition<F>, S, Scope>, ...scope: [Scope] extends [never] ? [] : [scope: Scope]): S;
  /** Write a snapshot now (no-op without a store). */
  save(): Promise<void>;
  dispose(): void;
}
type DepsOption<F extends AnyFlow> = {} extends RequiredDepsOf<F> ? {
  readonly deps?: Partial<DepsOf<F>>;
} : {
  readonly deps: RequiredDepsOf<F> & Partial<DepsOf<F>>;
};
/**
 * `wizard.create` options: the context input (parsed by the flow's context boundary), `deps`
 * (required iff the flow declares a deps boundary), persistence and injectables.
 * @public
 */
type RunOptions<F extends AnyFlow> = {
  readonly context: ContextInput<F>;
  readonly instanceId?: string;
  /**
   * Correlation id of this instance (`defineWizard({ correlate }, build)`): a delivered event whose
   * extracted id differs is dropped (`event.dropped { reason: 'correlation' }`). Persisted in the
   * snapshot (`state.correlationId`), so resume needs no option.
   */
  readonly correlationId?: string;
  readonly store?: Store;
  /** Store key; defaults to the instance id. */
  readonly key?: string;
  /** Default `'change'` when a store is given. */
  readonly autoSave?: 'change' | 'off';
  /** Coalesce auto-saves (ms). Default 0 = write after each drain that changed state. */
  readonly debounceMs?: number;
  /** Applied to the snapshot right before `store.set`. */
  readonly redact?: (snapshot: Snapshot<F>) => unknown;
  /**
   * Called when an auto-save cannot be written: the store rejected, or the snapshot is not
   * JSON-serializable (`WizardError('SNAPSHOT_NOT_SERIALIZABLE')` naming the exact path, e.g.
   * `state.steps.save.output.createdAt`). The same failure is also logged as a `persist.failed`
   * event. Default: rethrown asynchronously (an uncaught error).
   */
  readonly onPersistError?: (error: unknown) => void;
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly ids?: IdGenerator;
  /**
   * Optional host barrier. It sees the staged snapshot before the transition is
   * published or any planned run, child, or timer effect runs. Throwing or rejecting aborts the
   * runtime; normal runs leave it unset.
   */
  readonly beforeEffects?: (input: {
    readonly snapshot: Snapshot<F>;
    readonly events: readonly RunEvent<F>[];
    /** Exact dispatch inputs associated with this batch, with their result when final. */
    readonly commands: readonly {
      readonly command: Command<F>;
      readonly result?: CommandResult;
    }[];
  }) => void | Promise<void>;
  /** Optional host gate that must claim a timer before its fire message is enqueued. */
  readonly beforeTimer?: (timer: {
    readonly timerId: string;
    readonly dueAt: number;
    readonly expected: {
      readonly epoch: number;
      readonly seq: number;
    };
  }) => boolean | Promise<boolean>;
  /** Turn the first thenable returned by a hook into a `SYNC_VIOLATION` failure. */
  readonly strict?: 'sync';
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number;
  /** Isolate listener exceptions; the default rethrows asynchronously. */
  readonly onListenerError?: (error: unknown) => void;
  /**
   * The dedupe window of `send(…, { eventId })`: an id is remembered (in the snapshot) for `ttl`
   * and at most `limit` ids are kept, oldest dropped first. Default `{ ttl: '24h', limit: 1000 }`.
   */
  readonly eventIds?: {
    readonly ttl?: Duration;
    readonly limit?: number;
  };
} & DepsOption<F>;
/**
 * Snapshot migration (`resume(snapshot, { migrate })`): called with the raw snapshot when its
 * `flow.version` differs from the flow's, and the flow identity (`from`); returns the converted
 * snapshot, which is stamped with the flow's current version and validated like any other
 * (`renameSteps` rewrites renamed step ids). `flow.name` must always match. May return a
 * promise — then only `resumeAsync` accepts it.
 * @public
 */
type SnapshotMigration = SnapshotMigration$1;
/** The options shared by creation and resume (persistence, injectables, deps). */
type SharedOptions<F extends AnyFlow> = Omit<RunOptions<F>, 'context' | 'instanceId' | 'correlationId'>;
/**
 * `wizard.resume` options: `RunOptions` without `context` / `instanceId` / `correlationId`
 * (they come from the snapshot), plus `migrate` for snapshots of an older flow `version`.
 * @public
 */
type ResumeOptions<F extends AnyFlow> = SharedOptions<F> & {
  readonly migrate?: SnapshotMigration;
};
//#endregion
//#region src/authoring/types/wizard.d.ts
/** Author documentation, copied to the manifest that `inspect` returns. */
interface WizardProse {
  /** What the wizard is for, in a sentence or two. `toMarkdown` prints it under the title. */
  readonly description?: string;
  /** JSON data for tools. The runtime never reads it. */
  readonly meta?: Readonly<Record<string, JsonValue>>;
}
interface WizardPolicies {
  /** What happens when a step fails for good with no `fallback`. Default `'halt'`. */
  readonly onFailure?: 'halt' | 'compensate';
  readonly retry?: RetryPolicy;
  readonly autoRun?: 'ready' | 'manual';
  readonly concurrency?: number;
  readonly unmatchedEvents?: {
    readonly buffer: boolean;
    readonly ttl: Duration;
  };
}
/** Definition header with context, event and dependency boundaries. @public */
interface WizardDefinition<C, CIn, Ev, D, O, EvIn = Ev> extends WizardPolicies, WizardProse {
  readonly name: string;
  readonly version?: number;
  readonly context: Boundary<C, CIn>;
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown>; } & { readonly [E in keyof EvIn]: Boundary<unknown, EvIn[E]>; };
  readonly deps?: Boundary<D, unknown>;
  /** Output selector; without it the output is the last completed sink step's output. */
  readonly output?: (args: {
    readonly context: NoInfer<C>;
  }) => O & (O extends PromiseLike<unknown> ? never : unknown);
  readonly on?: NoInfer<{ readonly [E in keyof Ev]?: (args: FlowOnArgs<C, D, Ev[E], E>) => MaybePromise<void | {
    readonly cancel: string;
  }>; }>;
  readonly correlate?: NoInfer<{ readonly [E in keyof Ev]?: (payload: Ev[E]) => string | undefined; }>;
}
/** Phantom facts of a flow; `provided` holds the dep keys bound by `provide()`. */
interface FlowTypes<C, CIn, Ev, D, T, O, P extends PropertyKey, EvIn = Ev> {
  readonly ctx: C;
  readonly ctxIn: CIn;
  readonly events: Ev;
  readonly eventsIn: EvIn;
  readonly deps: D;
  readonly steps: T;
  readonly output: O;
  readonly provided: P;
}
/** The declarative definition accepted by inspectors and flow consumers. @public */
interface Flow<C, CIn, Ev, D, T, O = never, P extends PropertyKey = never, EvIn = Ev> extends WizardPolicies, WizardProse {
  readonly '~types': FlowTypes<C, CIn, Ev, D, T, O, P, EvIn> | undefined;
  readonly name: string;
  readonly version?: number;
  readonly context: Boundary<C, CIn>;
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown>; };
  readonly deps?: Boundary<D, unknown>;
  readonly providedDeps?: Readonly<Record<string, unknown>>;
  readonly on?: { readonly [E in keyof Ev]?: (args: never) => unknown; };
  readonly correlate?: { readonly [E in keyof Ev]?: (payload: never) => string | undefined; };
  readonly output?: (args: never) => unknown;
  readonly steps: T;
  readonly start?: string | readonly string[];
}
/** A structural constraint for code that reads any flow definition. @public */
type AnyFlow = Flow<unknown, unknown, unknown, unknown, unknown, unknown, PropertyKey, unknown>;
type RemainingDeps<D, P extends PropertyKey> = [P] extends [never] ? D : { [K in keyof D as K extends P ? never : K]: D[K]; };
/** Creation options requiring only dependencies not already provided. @public */
type WizardOptions<F extends AnyFlow> = Omit<RunOptions<F>, 'context' | 'deps'> & ({} extends RequiredDepsOf<F> ? {
  readonly deps?: Partial<DepsOf<F>>;
} : {
  readonly deps: RequiredDepsOf<F> & Partial<DepsOf<F>>;
});
/** Restore options with run identity taken from the snapshot. @public */
type WizardResumeOptions<F extends AnyFlow> = Omit<WizardOptions<F>, 'instanceId' | 'correlationId'> & Pick<ResumeOptions<F>, 'migrate'>;
type SureKeys<Q> = { [K in keyof Q]-?: {} extends Pick<Q, K> ? never : K; }[keyof Q];
type OptionsArgs<O> = {} extends O ? [options?: O] : [options: O];
/** A wizard IS its flow, plus run constructors. `provide()` returns a new wizard. */
/** A flow with bound creation, resume, execution and dependency methods. @public */
interface Wizard<C, CIn, Ev, D, T, O = never, P extends PropertyKey = never, EvIn = Ev> extends Flow<C, CIn, Ev, D, T, O, P, EvIn> {
  create(input: CIn, ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>): Run<this>;
  createAsync(input: CIn, ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>): Promise<Run<this>>;
  resume(snapshot: unknown, ...options: OptionsArgs<WizardResumeOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>): Run<this>;
  resumeAsync(snapshot: unknown, ...options: OptionsArgs<WizardResumeOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>): Promise<Run<this>>;
  /** Runs until done, failed, cancelled, halted or waiting on a view/event; never hangs or throws for step failures. */
  run(input: CIn, ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>): Promise<RunOutcome<this>>;
  /** Like `run`, synchronously; throws `SYNC_VIOLATION` naming the step when work cannot finish synchronously. */
  runSync(input: CIn, ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>): RunOutcome<this>;
  /** Bind some deps; the rest stay required wherever runs are created. */
  provide<Q extends Partial<D>>(deps: Q & { readonly [X in Exclude<keyof Q, keyof D>]: StepError<`'${X & string}' is not a dependency of this wizard`>; }): Wizard<C, CIn, Ev, D, T, O, P | Extract<SureKeys<Q>, keyof D>, EvIn>;
}
/**
 * What a wizard's step map degrades to when the `defineWizard` call itself is invalid (e.g. a
 * missing `name`): TypeScript then skips `build`, so ids/outputs are unknown. Loose on purpose,
 * so the one reported error does not cascade into every use of the wizard.
 */
interface UncheckedSteps {
  readonly [id: string]: FlowStep<StepKind, any, 'sink'>;
}
type RoleIn<S> = S extends {
  readonly '~role': infer R;
} ? NonNullable<R> : never;
type OutputIn<S> = S extends {
  readonly '~types': infer X;
} ? NonNullable<X> extends {
  readonly output: infer O;
} ? O : never : never;
/** Structural constraint for code that creates runs of any wizard (durable hosts, registries). */
/** A structural constraint for adapters that create or resume wizard runs. @public */
type AnyWizard = AnyFlow & {
  create(input: never, ...options: never[]): unknown;
  resume(snapshot: unknown, ...options: never[]): unknown;
};
//#endregion
//#region src/authoring/types/extractors.d.ts
type TypesOf<F extends AnyFlow> = NonNullable<F['~types']>;
/** The parsed context seen by hooks. @public */
type Ctx<F extends AnyFlow> = TypesOf<F>['ctx'];
/** The input accepted by the context boundary at run creation. @public */
type ContextInput<F extends AnyFlow> = TypesOf<F>['ctxIn'];
/** Every dep the hooks see. */
/** All dependencies seen by hooks, including supplied dependencies. @public */
type DepsOf<F extends AnyFlow> = TypesOf<F>['deps'];
/** Deps still required when a run is created (`DepsOf` minus what `provide()` bound). */
/** The dependencies still required when creating or resuming a run. @public */
type RequiredDepsOf<F extends AnyFlow> = RemainingDeps<TypesOf<F>['deps'], TypesOf<F>['provided']>;
type EventMapOf<F extends AnyFlow> = unknown extends TypesOf<F>['events'] ? Record<string, unknown> : TypesOf<F>['events'];
type EventInputMapOf<F extends AnyFlow> = unknown extends TypesOf<F>['eventsIn'] ? Record<string, unknown> : TypesOf<F>['eventsIn'];
/** The event boundary input accepted by send. @public */
type PayloadInput<F extends AnyFlow, E extends EventType<F>> = EventInputMapOf<F>[E & keyof EventInputMapOf<F>];
/** The declared external event names. @public */
type EventType<F extends AnyFlow> = Extract<keyof EventMapOf<F>, string>;
/** The parsed event payload seen by handlers. @public */
type PayloadOf<F extends AnyFlow, E extends EventType<F>> = EventMapOf<F>[E];
type StepsOf<F extends AnyFlow> = TypesOf<F>['steps'];
/** The literal ids of an assembled wizard. @public */
type StepId<F extends AnyFlow> = unknown extends StepsOf<F> ? string : Extract<keyof StepsOf<F>, string>;
type FactsOf<F extends AnyFlow, K> = unknown extends StepsOf<F> ? StepFacts : K extends keyof StepsOf<F> ? NonNullable<StepsOf<F>[K]['~types' & keyof StepsOf<F>[K]]> : never;
type Fact<F extends AnyFlow, K, P extends keyof StepFacts> = FactsOf<F, K> extends (infer X) ? (P extends keyof X ? X[P] : never) : never;
/** The kind of a step in an assembled wizard. @public */
type KindOf<F extends AnyFlow, K> = unknown extends StepsOf<F> ? StepKind : K extends keyof StepsOf<F> ? StepsOf<F>[K] extends {
  readonly kind: infer Kd;
} ? Kd : never : never;
/** The inferred output of one step. @public */
type OutputOf<F extends AnyFlow, K extends StepId<F>> = Fact<F, K, 'output'>;
/** The raw input of a view, or never for steps without input. @public */
type InputOf<F extends AnyFlow, K extends StepId<F>> = Fact<F, K, 'input'>;
/** A partial patch of a view boundary input. @public */
type DraftOf<F extends AnyFlow, K extends StepId<F>> = Partial<InputOf<F, K>>;
/** The JSON error data produced by mapError or a run adapter. @public */
type ErrorOf<F extends AnyFlow, K extends StepId<F>> = Fact<F, K, 'error'>;
/** Whether a step maps over items. @public */
type IsEach<F extends AnyFlow, K extends StepId<F>> = [Fact<F, K, 'each'>] extends [never] ? false : NonNullable<Fact<F, K, 'each'>>;
/** The child flow of a flow step, or never for other step kinds. @public */
type ChildFlowOf<F extends AnyFlow, K extends StepId<F>> = unknown extends StepsOf<F> ? AnyFlow : Extract<Fact<F, K, 'child'>, AnyFlow>;
/** The ids of view steps. @public */
type ViewId<F extends AnyFlow> = { [K in StepId<F>]: [KindOf<F, K>] extends ['view'] ? K : [StepKind] extends [KindOf<F, K>] ? K : never; }[StepId<F>];
/** The ids of runnable steps. @public */
type RunStepId<F extends AnyFlow> = { [K in StepId<F>]: [Fact<F, K, 'runnable'>] extends [never] ? never : [Fact<F, K, 'runnable'>] extends [false] ? never : K; }[StepId<F>];
/** The ids of runnable steps and mapped child flows that can retry failed items. @public */
type RetryStepId<F extends AnyFlow> = { [K in StepId<F>]: K extends RunStepId<F> ? K : [IsEach<F, K>] extends [true] ? K : never; }[StepId<F>];
/** The ids of child-flow steps. @public */
type ChildStepId<F extends AnyFlow> = { [K in StepId<F>]: [KindOf<F, K>] extends ['flow'] ? K : [StepKind] extends [KindOf<F, K>] ? K : never; }[StepId<F>];
/** The stored selector result or resolved union of sink outputs. @public */
type FlowOutput<F extends AnyFlow> = TypesOf<F>['output'];
//#endregion
//#region src/authoring/types/handlers.d.ts
/** What a `waitFor` handler returns: nothing (output = payload), `{ done }`, keep waiting, or fail. */
/** A wait verdict: complete with payload or done, keep waiting, or fail. @public */
type WaitResult = void | undefined | {
  readonly done: unknown;
  readonly next?: never;
} | {
  readonly keep: true;
  readonly next?: never;
} | {
  readonly fail: string;
  readonly next?: never;
};
/** Wait handlers with parsed event payloads and a closed return contract. @public */
type WaitHandlers<C, Ev, D, N> = { readonly [E in keyof Ev]?: (args: EventArgs<C, D, Ev[E], E, N>) => MaybePromise<WaitResult>; };
/** Contextual handler checks and return-value inference use separate maps. */
type WaitHandlersFor<C, Ev, D, N, H, Wk extends PropertyKey> = { readonly [E in keyof H | Wk]: E extends keyof Ev ? (args: EventArgs<C, D, Ev[E], E, N>) => E extends keyof H ? H[E] extends ((...args: never[]) => infer R) ? R & MaybePromise<WaitResult> : MaybePromise<WaitResult> : MaybePromise<WaitResult> : StepError<`'${E & string}' is not an event of this wizard`>; };
/** `Wk` = the handler keys written (survives a failed call, unlike `H`). */
type EmptyWait<Xk, Wk> = 'waitFor' extends Xk ? [Wk] extends [never] ? '`waitFor` needs at least one event handler' : never : never;
/** Passive handlers for declared external events. @public */
type OnHandlers<C, Ev, D, N, R = void> = { readonly [E in keyof Ev]?: (args: EventArgs<C, D, Ev[E], E, N>) => MaybePromise<R | undefined>; };
//#endregion
//#region src/authoring/types/step-config.d.ts
type CheckedNeed = NeedRef & {
  readonly any?: readonly StepLike[];
  readonly optional?: StepLike;
};
interface Common<C, D, Nd> {
  readonly label?: string;
  readonly description?: string;
  readonly meta?: Readonly<Record<string, JsonValue>>;
  /**
   * Typed data join: the step waits until every need is done, and hooks get `needs` typed.
   * Finished producers start the step, unless a function `next` lists it in `targets`: then it
   * starts only when chosen.
   */
  readonly needs?: Nd & { readonly [A in keyof Nd]: CheckedNeed; };
  readonly when?: (args: HookArgs<C, D, NeedsOutput<Nd>>) => MaybePromise<boolean>;
  readonly enter?: (args: EnterArgs<C, D, NeedsOutput<Nd>>) => unknown;
}
type NextResult<R> = MaybePromise<R | readonly R[] | null>;
type NextHandler<C, D, O, N, R> = (args: OutputArgs<C, D, O, N>) => NextResult<R>;
type Next<C, D, O, N, Nx, Nr> = Nx | readonly Nx[] | null | NextHandler<C, D, O, N, Nr>;
interface Routing<C, D, O, Nd, Nx, Nr, Tg> {
  /** Push edge: an id/step, several, `null`, or a function of the output (requires `targets`). */
  readonly next?: Next<C, D, O, NeedsOutput<Nd>, Nx, Nr>;
  /** Every id a function `next` may return; untaken targets are skipped (`not-taken`). */
  readonly targets?: readonly Tg[];
}
interface StepConfig<C, Ev, D, R, OB, Em, Ea, Item, Nd, Nx, Nr, Tg, Fb, To, H, Xk, Wk extends PropertyKey = never> extends Common<C, D, Nd>, Routing<C, D, NoInfer<StepOutput<R, OB, Item, H, Ev, Xk>>, Nd, Nx, Nr, Tg> {
  readonly exit?: (args: ExitArgs<C, D, NoInfer<StepOutput<R, OB, Item, H, Ev, Xk>>, NeedsOutput<Nd>>) => unknown;
  readonly on?: OnHandlers<C, Ev, D, NeedsOutput<Nd>>;
  readonly run?: ((args: 'each' extends Xk ? EachRunArgs<C, D, NeedsOutput<Nd>, Item> : RunArgs<C, D, NeedsOutput<Nd>>) => R | NoInfer<RunAdapter<C, D, unknown, Ea & JsonValue>>) | RunAdapter<C, D, R, Ea & JsonValue, 'each' extends Xk ? EachRunArgs<C, D, NeedsOutput<Nd>, Item> : RunArgs<C, D, NeedsOutput<Nd>>>;
  /** Map over items: `run` gets `item` / `index`, the output is an array in input order. */
  readonly each?: (args: HookArgs<C, D, NeedsOutput<Nd>>) => readonly Item[];
  readonly key?: (item: NoInfer<Item>, index: number) => string;
  readonly concurrency?: number;
  readonly output?: Boundary<OB, unknown>;
  readonly retry?: RetryPolicy<NoInfer<RetryError<Em, Ea | ReturnedAdapterError<R>>>>;
  /**
   * With `run`, a deadline for each attempt. With `waitFor`, `{ after, next }`: when no event
   * completes the wait in time, the wait is skipped (`timeout`) and the run continues at `next`.
   */
  readonly timeout?: Duration | {
    readonly after: Duration;
    readonly next: To;
  };
  readonly compensate?: (args: CompensateArgs<C, D, NoInfer<StepOutput<R, OB, Item, H, Ev, Xk>>, NeedsOutput<Nd>>) => unknown;
  /**
   * Marks the step safe to run again after a crash. `true` passes `run` a key built from the
   * run, step and attempt ids; a function returns your own key. `run` reads it as
   * `idempotencyKey` and hands it to the service that must not act twice.
   */
  readonly idempotencyKey?: boolean | ((args: RunArgs<C, D, NeedsOutput<Nd>>) => string);
  readonly mapError?: (error: unknown, args: RunArgs<C, D, NeedsOutput<Nd>>) => MaybePromise<Em>;
  /** When the step fails for good it is skipped (`fallback`) and the run continues here. */
  readonly fallback?: Fb;
  readonly waitFor?: H & WaitHandlersFor<C, Ev, D, NeedsOutput<Nd>, H, Wk> & OptionKeys<Wk, PropertyKey>;
  /** Durable timer: completes when due (survives restarts). */
  readonly sleep?: Duration | ((args: HookArgs<C, D, NeedsOutput<Nd>>) => Duration);
}
interface ViewConfig<C, Ev, D, I, O, Nd, Nx, Nr, Tg, Nh = never> extends Common<C, D, Nd>, Routing<C, D, NoInfer<O>, Nd, Nx, Nr, Tg> {
  /** Draft boundary: hooks see the OUTPUT side, `setInput` / `initial` the INPUT side. */
  readonly input?: Boundary<O, I>;
  readonly initial?: NoInfer<Partial<I>> | ((args: {
    readonly context: C;
    readonly deps: D;
  }) => MaybePromise<NoInfer<Partial<I>>>);
  readonly validate?: (args: OutputArgs<C, D, NoInfer<O>, NeedsOutput<Nd>>) => MaybePromise<void | undefined | readonly Issue$1[]>;
  readonly canEnter?: (args: EnterArgs<C, D, NeedsOutput<Nd>>) => MaybePromise<boolean>;
  readonly canExit?: (args: OutputArgs<C, D, NoInfer<O>, NeedsOutput<Nd>>) => MaybePromise<boolean>;
  readonly exit?: (args: ExitArgs<C, D, NoInfer<O>, NeedsOutput<Nd>>) => unknown;
  /** A handler may navigate: its `next` ids are checked like any other ref. */
  readonly on?: OnHandlers<C, Ev, D, NeedsOutput<Nd>, {
    readonly next?: Nh | null;
  }>;
}
type ChildOutput<CO, OB, Item> = EachOf<Item, IsUnset<OB> extends true ? CO : OB>;
/** `flow(child, config)`: `CIn` / `CO` / `CD` are the child's context input, output and deps. */
interface ChildConfig<C, Ev, D, CIn, CO, CD, OB, Item, Nd, Nx, Nr, Tg, Fb> extends Common<C, D, Nd>, Routing<C, D, NoInfer<ChildOutput<CO, OB, Item>>, Nd, Nx, Nr, Tg> {
  /** Builds the child's context input (per item with `each`). */
  readonly context: (args: HookArgsFor<C, D, NeedsOutput<Nd>, Item>) => CIn;
  readonly each?: (args: HookArgs<C, D, NeedsOutput<Nd>>) => readonly Item[];
  readonly key?: (item: NoInfer<Item>, index: number) => string;
  readonly concurrency?: number;
  readonly output?: Boundary<OB, unknown>;
  readonly fallback?: Fb;
  readonly exit?: (args: ExitArgs<C, D, NoInfer<ChildOutput<CO, OB, Item>>, NeedsOutput<Nd>>) => unknown;
  readonly on?: OnHandlers<C, Ev, D, NeedsOutput<Nd>>;
  /** Child deps, merged over what the child had `provide()`d. */
  readonly deps?: (args: HookArgsFor<C, D, NeedsOutput<Nd>, Item>) => CD;
}
/** What a child `deps` mapper returns: the child's remaining deps, optionally overriding provided ones. */
type ChildDeps<CF extends AnyFlow> = [NonNullable<CF['~types']>['provided']] extends [never] ? DepsOf<CF> : RequiredDepsOf<CF> & { [K in keyof DepsOf<CF> as K extends NonNullable<CF['~types']>['provided'] ? K : never]?: DepsOf<CF>[K]; };
/** Added when this wizard's deps do not cover `RequiredDepsOf<child>`: the `deps` mapper is required. */
interface ChildDepsRequired<C, D, Nd, CD, Item> {
  readonly deps: (args: HookArgsFor<C, D, NeedsOutput<Nd>, Item>) => CD;
}
type DepsRule<C, D, Nd, Item, CF extends AnyFlow> = {} extends RequiredDepsOf<CF> ? unknown : [D] extends [RequiredDepsOf<CF>] ? unknown : ChildDepsRequired<C, D, Nd, ChildDeps<CF>, Item>;
/** Records which options a config literal was written with (`Xk`); unknown keys stay excess errors. */
type OptionKeys<Xk, Known extends PropertyKey> = { readonly [P in Xk & Known]?: unknown; } & { readonly [P in Xk & Known & ('run' | 'waitFor' | 'sleep' | 'input' | 'each' | 'output' | 'needs' | 'next' | 'targets')]: unknown; };
type StepOption = keyof StepConfig<unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown>;
type ViewOption = keyof ViewConfig<unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown>;
type ChildOption = keyof ChildConfig<unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown>;
//#endregion
//#region src/authoring/types/step-api.d.ts
interface Steps<M> {
  readonly '~steps': M | undefined;
}
/** Constructors pre-bound to a wizard's context `C`, events `Ev` and deps `D`. */
/** Constructors bound to one context, event map and dependency type. @public */
interface StepApi<C, Ev, D> {
  step<R = any, OB = Unset, Em extends JsonValue | Unset = Unset, Ea extends JsonValue = never, Item = any, Nd = {}, Nx extends Ref | null = never, Tg extends Ref = never, Nr extends RefWithin<Tg> = never, Fb extends Ref = never, To extends Ref = never, H extends { readonly [E in Wk]?: (...args: never[]) => MaybePromise<WaitResult>; } = {}, Wk extends string = never, Xk extends string = never>(config: StepConfig<C, Ev, D, R, OB, Em, Ea, Item, Nd, Nx, Nr, Tg, Fb, To, H, Xk, Wk> & OptionKeys<Xk, StepOption>): Step<'step', RunFacts<StepOutput<R, OB, Item, H, Ev, Xk>, ErrorFor<Em, Ea | ReturnedAdapterError<R>>, 'run' extends Xk ? true : false> & ('each' extends Xk ? {
    readonly each: true;
  } : {}), Links<IdRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb | To>, ObjRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb | To>, Nd, Tg | Fb | To, HasSuccessor<Nx, Tg>, StepProblems<Xk, To> | ReturnedAdapterProblem<R, C, D, Nd, Item, Xk> | RoutingProblem<Xk, Nx, Nr, Tg> | EmptyWait<Xk, Wk>, 'when' extends Xk ? true : false, Route<Returned<Nr, Tg>, Tg>>, BoundTo<C, Ev, D>>;
  view<I = never, O = [I] extends [never] ? undefined : I, Nd = {}, Nx extends Ref | null = never, Tg extends Ref = never, Nr extends RefWithin<Tg> = never, Nh extends Ref = never, Xk extends string = never>(config: ViewConfig<C, Ev, D, I, O, Nd, Nx, Nr, Tg, Nh> & OptionKeys<Xk, ViewOption>): Step<'view', {
    readonly input: I;
    readonly output: O;
  }, Links<IdRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Nh>, ObjRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Nh>, Nd, Tg | Nh, HasSuccessor<Nx, Tg>, RoutingProblem<Xk, Nx, Nr, Tg>, 'when' extends Xk ? true : false, Route<Returned<Nr, Tg>, Tg>>, BoundTo<C, Ev, D>>;
  flow<CF extends AnyFlow, OB = Unset, Item = Unset, Nd = {}, Nx extends Ref | null = never, Tg extends Ref = never, Nr extends RefWithin<Tg> = never, Fb extends Ref = never, Xk extends string = never>(child: CF, config: ChildConfig<C, Ev, D, ContextInput<CF>, FlowOutput<CF>, ChildDeps<CF>, OB, Item, Nd, Nx, Nr, Tg, Fb> & DepsRule<C, D, Nd, Item, CF> & OptionKeys<Xk, ChildOption>): Step<'flow', {
    readonly output: ChildOutput<FlowOutput<CF>, OB, Item>;
    readonly child: CF;
  } & ('each' extends Xk ? {
    readonly each: true;
  } : {}), Links<IdRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb>, ObjRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb>, Nd, Tg | Fb, HasSuccessor<Nx, Tg>, RoutingProblem<Xk, Nx, Nr, Tg>, 'when' extends Xk ? true : false, Route<Returned<Nr, Tg>, Tg>>, BoundTo<C, Ev, D>>;
  /**
   * Assemble the wizard. Every reference, need, target and binding is checked here; a bad step
   * gets a diagnostic on its own property. `start` defaults to the first step.
   */
  steps<T>(map: CheckSteps<T, C, Ev, D>, options?: {
    readonly start?: NoInfer<Extract<keyof T, string>> | readonly [NoInfer<Extract<keyof T, string>>, ...NoInfer<Extract<keyof T, string>>[]];
  }): Steps<{ readonly [K in keyof T]: CompactStep<T[K], RoleOf<T, K>>; }>;
}
//#endregion
//#region src/authoring/boundary.d.ts
/**
 * Build a branded `Checker` from a plain function: `parse` (returns the value or throws),
 * `guard` (type predicate), `assert` (assertion function) or `trusted<T>()` (no runtime check —
 * a grep-able escape hatch for data you already trust).
 * @public
 */
declare const boundary: {
  parse<T>(fn: (value: unknown) => T): Checker<T>;
  guard<T>(fn: (value: unknown) => value is T): Checker<T>;
  assert<T>(fn: (value: unknown) => asserts value is T): Checker<T>;
  trusted<T>(): Checker<T>;
};
//#endregion
//#region src/wizard/define-wizard.d.ts
/**
 * Define a wizard. Return `steps(map, { start? })` from the callback.
 * Context, dependencies, events, step references and sink outputs are inferred.
 * @public
 */
declare function defineWizard<C, CIn, Ev = {}, D = unknown, O = never, M = UncheckedSteps, EvIn = Ev>(options: WizardDefinition<C, CIn, Ev, D, O, EvIn>, build: (api: StepApi<C, Ev, D>) => Steps<M>): Wizard<C, CIn, Ev, D, M, [O] extends [never] ? { [K in keyof M]: RoleIn<M[K]> extends 'inner' ? never : OutputIn<M[K]>; }[keyof M] | ('sink' extends { [K in keyof M]: RoleIn<M[K]>; }[keyof M] ? never : undefined) : O, never, EvIn>;
//#endregion
//#region src/persistence/memory-store.d.ts
/**
 * What `createMemoryStore()` returns: a `Store` plus `keys()` / `clear()` for tests and diagnostics.
 * @public
 */
interface MemoryStore extends Store {
  /** Stored keys (tests / diagnostics). */
  keys(): readonly string[];
  clear(): void;
}
/**
 * In-memory `Store` (JSON round-trip on every `set`/`get`) for tests, examples and single-process use.
 *
 * @public
 */
declare function createMemoryStore(): MemoryStore;
//#endregion
//#region src/wizard/rename-steps.d.ts
/**
 * `renameSteps(snapshot, { oldId: 'newId' })` — the migration helper for a renamed step: rewrites
 * every place a persisted run refers to a step id (records, cursor, history, navigation, saga,
 * timers, failures, child snapshots) so the snapshot resumes under the new definition.
 *
 * @packageDocumentation
 */
type Renames = Readonly<Record<string, string>>;
/**
 * Rename step ids in a persisted snapshot (the root flow's steps; a renamed flow step keeps its
 * child snapshot). Use it inside `migrate` after bumping the flow's `version`:
 * `wizard.resume(saved, { migrate: (s) => renameSteps(s, { pay: 'charge' }) })`.
 * The input is not mutated; anything that is not a snapshot is returned unchanged.
 * @public
 */
declare function renameSteps(snapshot: unknown, renames: Renames): unknown;
//#endregion
//#region src/wizard/parse-command.d.ts
/**
 * Strictly decode an untrusted wire value into a `Command<F>` of `flow`: exact per-type field
 * allow-lists, JSON-only payloads, child path depth ≤ 8, and every step id / event name checked
 * against the flow (unknown → issues). Use it before `dispatch()` on anything from a transport.
 *
 * @public
 */
declare function parseCommand<F extends AnyFlow>(flow: F, input: unknown): BoundaryResult<Command<F>>;
//#endregion
//#region src/replay.d.ts
/**
 * `replay` options. Either `context` (the context INPUT the run was created with, parsed
 * through the flow's context boundary — the fold starts from the initial state, so the events
 * must begin at `seq` 1) or `from` (a base state — `getState()` captured earlier — the fold
 * starts there and events with `seq <= from.seq` are skipped; a truncated log or a resumed
 * run need it). `upTo` stops the fold after that `seq` (inclusive); `instanceId` /
 * `correlationId` seed the initial state (`from` carries its own).
 * @public
 */
type ReplayOptions<F extends AnyFlow> = {
  readonly upTo?: number;
  readonly instanceId?: string;
  readonly correlationId?: string;
} & ({
  readonly context: ContextInput<F>;
  readonly from?: undefined;
} | {
  readonly from: Snapshot<F>['state'];
  readonly context?: undefined;
});
/**
 * Fold `events` (a `log()` slice or anything captured with `observe()`, in `seq` order) with the
 * machine's `apply`, from the initial state built from `options.context` (parsed through the
 * flow's context boundary; async boundary → `DEFINITION_INVALID`, rejection →
 * `BOUNDARY_REJECTED`) or from `options.from`, up to `options.upTo` (inclusive). Returns the
 * state at that point — read-only, no hook runs, no effect. Child events (`path` non-empty) and
 * `persist.failed` are skipped. Pure and deterministic: for a fresh run whose log was not
 * truncated by `logSize`, `replay(flow, run.log(), { context, instanceId: run.id })` deep-equals
 * `run.getState()`.
 * @public
 */
declare function replay<F extends AnyFlow>(flow: F, events: readonly RunEvent<F>[], options: ReplayOptions<F>): Snapshot<F>['state'];
//#endregion
export { type AnyFlow, type AnyProjection, type AnyStep, type AnyWizard, type Boundary, type Checker, type ChildCommand, type ChildFlowOf, type ChildRunEvent, type ChildStepId, type ChildSummary, type ClientState, type ClientStepError, type ClientStepState, type Clock, type Command, type CommandResult, type CompensationFailure, type CompensationSummary, type ContextInput, type ContextPatch, type Ctx, type DepsOf, type DispatchOptions, type DraftOf, type Duration, type EachRunArgs, type ErrorOf, type EventType, type Explanation, type ExposeSpec, type Flow, type FlowFailure, type FlowOutput, type FlowStep, type HookArgs, type InputOf, type IsEach, type Issue$1 as Issue, type JsonValue, type MemoryStore, type NavResult, type NeedRef, type NeedsOutput, type NeedsSpec, type OutputOf, type PayloadInput, type PayloadOf, type Progress, type ProgressSpec, type Projection, type ProjectionDefinition, type ProjectionFlow, type ProjectionOutput, type ProjectionScope, type ProjectionSelect, RUN_ADAPTER, RUN_EVENT_TYPES, type ReplayOptions, type RequiredDepsOf, type ResumeOptions, type RetryPolicy, type RetryStepId, type RootRunEvent, type Run, type RunAdapter, type RunAdapterMetadata, type RunArgs, type RunCancelled, type RunDone, type RunEvent, type RunEventType, type RunFailed, type RunFailure, type RunFailureKind, type RunHalted, type RunLifecycleCode, RunLifecycleError, type RunOptions, type RunOutcome, type RunResult, type RunStatus, type RunStepId, type RunWaiting, type Scheduler, type SendOptions, type SendResult, type SerializedError, type SetInputCommand, type Snapshot, type SnapshotMigration, type Step, type StepApi, type StepErrorOf, type StepExpose, type StepFailure, type StepId, type StepKind, type StepPhase, type StepState, type StepStatus, type Store, type ViewId, type WaitHandlers, type WaitResult, type WaitingFor, type Wizard, type WizardDefinition, WizardError, type WizardErrorCode, type WizardOptions, type WizardResumeOptions, boundary, createMemoryStore, createRunFailure, defineProjection, defineWizard, isChildEvent, isRunAdapter, isRunFailure, isWizardError, parseCommand, renameSteps, replay };
//# sourceMappingURL=index.d.ts.map