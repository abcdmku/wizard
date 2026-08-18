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
/** External event whose payload was ALREADY parsed by the flow's event boundary. */
{
  readonly type: 'send';
  readonly event: string;
  readonly payload: unknown;
  readonly correlationId?: string;
} |
/** External event that FAILED its boundary; recorded for observability. */
{
  readonly type: 'sendRejected';
  readonly event: string;
  readonly issues: readonly Issue$2[];
} | {
  readonly type: 'run';
  readonly step: string;
} | {
  readonly type: 'runReady';
} | {
  readonly type: 'retry';
  readonly step: string;
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
/** v0.2: skip a ready/active non-final step (`step.skipped { reason: 'command' }`). */
{
  readonly type: 'skip';
  readonly step: string;
  readonly reason?: string;
} |
/** v0.2: explicit invalidation of a done/failed/skipped step (+ transitive `dependsOn` dependents when `cascade`). */
{
  readonly type: 'invalidate';
  readonly step: string;
  readonly cascade?: boolean;
} |
/** Address a command to a nested flow. `path` is relative to this wizard (`['fulfil']`, `['fulfil','payment']`). */
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
//#region src/machine/state.d.ts
type StepStatus$1 = 'idle' | 'active' | 'done' | 'failed' | 'skipped' | 'cancelled' | 'compensating' | 'compensated';
type WizardStatus$1 = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'compensating' | 'cancelled';
type NavPhase = 'idle' | 'parsingInput' | 'validating' | 'canExit' | 'resolvingTarget' | 'canEnter' | 'exiting' | 'entering';
type NavCause = 'start' | 'next' | 'go' | 'back' | 'auto' | 'resume' | 'event';
type StepErrorKind = 'validation' | 'guard' | 'run' | 'timeout' | 'compensate' | 'interrupted' | 'child' | 'hook' | 'sync-violation';
/** Serializable error. Never carries a stack. */
interface SerializedError$1 {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}
interface StepError extends SerializedError$1 {
  readonly kind: StepErrorKind;
  readonly at: number;
  readonly attempt?: number;
  /** Standard-Schema issues when kind === 'validation'. */
  readonly issues?: readonly Issue$2[];
  /** v0.2: JSON-safe value produced by the task's `mapError` (typed for users via `ErrorOf<F, K>`). */
  readonly data?: unknown;
}
/** Standard Schema v1 issue (kept structural so core has zero runtime deps). */
interface Issue$2 {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | {
    readonly key: PropertyKey;
  }>;
}
interface GuardResult {
  readonly ok: boolean;
  /** seq of the event that recorded this result. */
  readonly seq: number;
  readonly reason?: string;
}
interface ChildSummary$1 {
  readonly status: WizardStatus$1;
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
   * Result of the step: parsed input (view), run result (task), resolving event
   * `{ event, payload }` (wait), chosen target (decision), child output (flow),
   * `output()` result (final).
   */
  readonly output?: unknown;
  /** Last validation issues (view). Cleared on the next input change. */
  readonly issues?: readonly Issue$2[];
  readonly error?: StepError;
  /** v0.2: output before the last explicit invalidation. */
  readonly previousOutput?: unknown;
  /** v0.2: why the step was skipped (`'when'` | `'command'`). */
  readonly skipReason?: string;
  /** Attempt counter for the current run (1-based while running; 0 when idle). */
  readonly attempt: number;
  /** Increments each time the step (re)starts after completion or invalidation. Used for stale-result tokens. */
  readonly runId: number;
  /** Scheduled retry time (task). */
  readonly retryAt?: number;
  /** Absolute wait timeout (wait). Re-armed on resume. */
  readonly deadline?: number;
  /** Idempotency key for the current run (task). */
  readonly idempotencyKey?: string;
  readonly guards: {
    readonly canEnter?: GuardResult;
    readonly canExit?: GuardResult;
  };
  /**
   * v0.2: state of the step's `when` predicate for the current activation — `'pending'` while the
   * call is in flight, `'passed'` once it returned true (the step may enter). Absent when the step
   * has no `when` hook or has not been evaluated yet; cleared on entry, skip and invalidation.
   */
  readonly when?: 'pending' | 'passed';
  /** True while the step's `enter` hook is in flight (kind-specific work starts after it resolves). */
  readonly entering?: boolean;
  /** The `enter` hook already ran for the pending activation (transition `entering` phase); cleared when the step enters. */
  readonly enterDone?: boolean;
  readonly enteredAt?: number;
  readonly exitedAt?: number;
  readonly visitedCount: number;
  /**
   * Set when `start` or a completed predecessor's `next` arrives here while the
   * step is not active; cleared when the step enters. Together with `dependsOn`
   * gating this is the readiness rule: `ready = pendingActivation && depsSatisfied`.
   */
  readonly pendingActivation: boolean;
  /** seq of the arrival that set `pendingActivation` (scheduler picks ready tasks in arrival order). */
  readonly arrivedSeq?: number;
  /** Child flow summary (flow steps). The full child snapshot lives in `Snapshot.children`. */
  readonly child?: ChildSummary$1;
}
interface NavState {
  readonly phase: NavPhase;
  readonly txId?: string;
  readonly from?: string | null;
  /** Resolved target(s) of the in-flight transition (first = cursor target). */
  readonly targets?: readonly string[];
  readonly cause?: NavCause;
  readonly direction?: 'forward' | 'back';
  /** Targets still awaiting a `canEnter` / `enter` result in the current phase. */
  readonly pendingSteps?: readonly string[];
  /** Auto-advance hop counter for the current command (guard against `next` loops). */
  readonly hops?: number;
  /**
   * Non-view steps that completed while a transition was in flight; their
   * auto-advance starts (in order) as soon as `nav` returns to idle.
   * `to` = target override carried by `step.done.next`.
   */
  readonly deferred?: ReadonlyArray<{
    readonly step: string;
    readonly to?: string;
  }>;
  /**
   * v0.2: the view a committed transition wanted as cursor but could not enter because its `when`
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
  /** Set while compensating; decides `flow.compensated.outcome`. */
  readonly outcome?: 'failed' | 'cancelled';
  readonly reason?: string;
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
  /** What the timer is for (set by `apply` from `timer.scheduled` / `step.retryScheduled`). */
  readonly purpose?: 'retry' | 'waitTimeout' | 'inboxTtl' | 'compensationGrace';
  /** Owner step for `retry` / `waitTimeout` timers. */
  readonly step?: string;
}
interface WizardState {
  readonly status: WizardStatus$1;
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
  /** Flow output once a `final` step ran (from its `output` hook). */
  readonly output?: unknown;
  readonly seq: number;
  readonly instanceId: string;
  /** v0.2: correlation id used to filter external events (`defineFlow({ correlate })`). */
  readonly correlationId?: string;
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
//#region src/authoring/compiled.d.ts
type StepKind$1 = 'view' | 'task' | 'wait' | 'decision' | 'flow' | 'final';
/** Result of parsing through a boundary. */
type BoundaryResult<T = unknown> = {
  readonly ok: true;
  readonly value: T;
} | {
  readonly ok: false;
  readonly issues: readonly Issue$2[];
};
/**
 * Retry policy — data only (the machine must stay pure, so no callback form).
 * `backoff`: fixed ms, or `'exponential'` = `min(baseMs * factor^(attempt-1), maxBackoffMs)`
 * with `baseMs` 200, `factor` 2, `maxBackoffMs` 30_000 by default; absent → 0 ms.
 */
interface RetryPolicy$1 {
  readonly attempts: number;
  readonly backoff?: number | 'exponential';
  readonly baseMs?: number;
  readonly factor?: number;
  readonly maxBackoffMs?: number;
}
type DepsSpec = {
  readonly all: readonly string[];
} | {
  readonly any: readonly string[];
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
 * input (draft) type — equal to `O` for checkers; the (private, nominal) brand keeps plain
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
 * A data door: any Standard Schema (Zod 4 / Valibot / ArkType / …) or a branded `Checker`.
 * `O` is the parsed output type, `I` the accepted input (draft) type.
 * @public
 */
type Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>;
//#endregion
//#region src/machine/selectors.d.ts
/** UI-facing live phase of a step (undefined when the step has no live phase: idle/done/failed/…). */
type StepPhase$1 = 'blocked' | 'ready' | 'entering' | 'validating' | 'running' | 'retrying' | 'waiting' | 'exiting' | 'compensating';
/** v0.2 (§9.6): completion counters over the non-final steps; `skipped` counts as done. */
interface Progress$1 {
  readonly done: number;
  readonly total: number;
  /** `done / total` (0 when there is nothing to count); 1 once the flow is `done`. */
  readonly ratio: number;
}
//#endregion
//#region src/authoring/types/primitives.d.ts
/**
 * A value or a promise of it — every hook may be sync or async.
 * @public
 */
type MaybePromise<T> = T | Promise<T>;
/**
 * A duration: milliseconds as a number, or a string with a unit (`'250ms'`, `'15m'`, `'2h'`, `'1d'`).
 * @public
 */
type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;
/**
 * Structural stand-in for the global `AbortSignal` (consumers need no DOM lib); the runtime passes a real one.
 * @public
 */
interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason: unknown;
}
/**
 * A validation problem (Standard Schema issue shape): a message and an optional path.
 * @public
 */
type Issue$1 = Issue$2;
/**
 * A serializable error (`name`, `message`, optional `code`) — never carries a stack.
 * @public
 */
type SerializedError = SerializedError$1;
/**
 * The six step kinds: `view | task | wait | decision | flow | final`.
 * @public
 */
type StepKind = StepKind$1;
/**
 * Stored status of a step: `idle | active | done | failed | skipped | cancelled | compensating | compensated`.
 * @public
 */
type StepStatus = StepStatus$1;
/**
 * Status of a wizard instance: `idle | running | waiting | done | failed | compensating | cancelled`.
 * @public
 */
type WizardStatus = WizardStatus$1;
/**
 * Retry policy for tasks (plain data, so `inspect()` shows it; the retry STATE — `attempt`, the
 * `retryAt` deadline — is what persists, the policy is read from the flow): `attempts` retries
 * after the first failure (`1` = one retry, two runs), spaced by `backoff` — a number is a fixed
 * delay in ms (absent = retry immediately); `'exponential'` waits
 * `min(baseMs × factor^(attempt-1), maxBackoffMs)` (`baseMs` 200, `factor` 2, `maxBackoffMs` 30 000).
 * @public
 */
type RetryPolicy = RetryPolicy$1;
/**
 * Progress of a wizard (`wizard.progress()`, `ClientState.progress` with `expose.progress: true`):
 * `total` counts the non-final steps, `done` those of them that are `done` or `skipped`,
 * `ratio` is `done / total` (`0` when there is nothing to count, `1` once the flow is `done`).
 * @public
 */
type Progress = Progress$1;
//#endregion
//#region src/authoring/types/hook-args.d.ts
/**
 * String keys of a steps map.
 * @public
 */
type Ids<T> = Extract<keyof T, string>;
/**
 * A `next` target: one id, several ids (fan-out) or `null` (no successor).
 * @public
 */
type NextRef<N extends string> = N | readonly N[] | null;
/**
 * Data-readiness dependencies: every listed step must be done (`readonly N[]`) or any of them (`{ any }`).
 * @public
 */
type DependsOn<N extends string> = readonly N[] | {
  readonly any: readonly N[];
};
/**
 * Sibling step state as seen from inside a hook. LIMITATION (ADR-001 L1): a constructor
 * runs before its siblings exist, so this map cannot be typed per flow — it is an open map
 * of unknown input/output. Cross-step data should travel through `context` (typed) instead.
 * @public
 */
interface SiblingState<I = unknown, O = unknown> {
  readonly kind: StepKind;
  readonly status: StepStatus;
  readonly attempt: number;
  readonly input?: I;
  readonly output?: O;
  readonly issues?: readonly Issue$1[];
  readonly error?: SerializedError;
}
/**
 * The open sibling map handed to hooks (`args.steps`).
 * @public
 */
type SiblingStates = {
  readonly [id: string]: SiblingState;
};
/**
 * Arguments every hook receives.
 * @public
 */
interface BaseArgs<C, D> {
  readonly context: C;
  /** Patch the flow context (recorded as `context.changed`). */
  readonly update: (patch: Partial<C>) => void;
  readonly deps: D;
  readonly steps: SiblingStates;
  readonly step: string;
  /** Wizard path (`[]` for the root, `['fulfil']` inside a child flow). */
  readonly path: readonly string[];
  readonly signal: AbortSignalLike;
}
/**
 * `run` hook arguments (`attempt` is 1-based). `idempotencyKey` identifies the run for the
 * out-of-domain service: `${instanceId}:${step}:${runId}` by default, or the value of the
 * task's `idempotent` key function; the same key is passed again when an idempotent task is
 * re-run after a crash.
 * @public
 */
interface RunArgs<C, D> extends BaseArgs<C, D> {
  readonly attempt: number;
  readonly idempotencyKey: string;
}
/**
 * `enter` / `canEnter` hook arguments.
 * @public
 */
interface EnterArgs<C, D> extends BaseArgs<C, D> {
  readonly from: string | null;
}
/**
 * Hook arguments carrying the step's output (`validate`, `canExit`, `next`).
 * @public
 */
interface OutputArgs<C, D, O> extends BaseArgs<C, D> {
  readonly output: O;
}
/**
 * `exit` hook arguments.
 * @public
 */
interface ExitArgs<C, D, O> extends OutputArgs<C, D, O> {
  readonly to: string | null;
  readonly direction: 'forward' | 'back';
}
/**
 * `compensate` hook arguments.
 * @public
 */
interface CompensateArgs<C, D, O> extends OutputArgs<C, D, O> {
  readonly reason: string | undefined;
}
/**
 * Step-level `on[event]` handler arguments (any kind since v0.2).
 * @public
 */
interface EventArgs<C, D, P, E> extends BaseArgs<C, D> {
  readonly event: E;
  readonly payload: P;
}
/**
 * Flow-level `on[event]` handler arguments (`defineFlow({ on })`): everything a step hook gets
 * except `step` (a flow-level handler belongs to no step), plus the event name and its parsed
 * payload.
 * @public
 */
interface FlowOnArgs<C, D, P, E = string> extends Omit<BaseArgs<C, D>, 'step'> {
  readonly event: E;
  readonly payload: P;
}
/**
 * `next` hook arguments (the step's output is available).
 * @public
 */
type NextArgs<C, D, O> = OutputArgs<C, D, O>;
/**
 * `mapError` hook arguments: the failed run's arguments (`attempt` = the attempt that failed).
 * @public
 */
type MapErrorArgs<C, D> = RunArgs<C, D>;
/**
 * A `next` specification: a static target (id / ids / null) or a function of the step's output.
 * @public
 */
type NextSpec<C, D, O, N extends string> = NextRef<N> | ((a: NextArgs<C, D, O>) => MaybePromise<NextRef<N>>);
/**
 * `when` predicate of a non-final step: evaluated once the step is ready (after `dependsOn`
 * gating, before `enter`); `false` skips it (`step.skipped { reason: 'when' }` — it counts as
 * done for `dependsOn`, its `next` targets are arrived, the cursor never lands on it).
 * @public
 */
type WhenSpec<C, D> = (a: BaseArgs<C, D>) => MaybePromise<boolean>;
/**
 * Output of a wait step: the resolving `{ event, payload }` (union over every flow event),
 * plus `{ event: 'timeout' }` when the step declares a `timeout` (`T` is the phantom captured
 * from `WaitCfg.timeout`: `undefined` when the step declares none; the default `unknown` keeps
 * the marker, i.e. "any wait step").
 * @public
 */
type WaitOutput<Ev, T = unknown> = { [E in keyof Ev]: {
  readonly event: E;
  readonly payload: Ev[E];
}; }[keyof Ev] | ([T] extends [undefined] ? never : {
  readonly event: 'timeout';
});
//#endregion
//#region src/authoring/types/handlers.d.ts
/**
 * What a `wait` step's `on[event]` handler may return: nothing (the event completes the step —
 * output `{ event, payload }` — through its static `next`), `{ next }` (a single id overriding
 * it; `null` / `undefined` = no override), `{ keep: true }` (consume the event, keep waiting),
 * `{ done: output, next? }` (complete with that output — `O`, the step's `WaitOutput` — instead
 * of the event) or `{ fail: reason }` (fail the step, `kind: 'hook'`).
 * @public
 */
type WaitOnResult<N extends string, O = unknown> = void | undefined | {
  readonly next?: N | null | undefined;
} | {
  readonly keep: true;
} | {
  readonly done: O;
  readonly next?: N | null | undefined;
} | {
  readonly fail: string;
};
/**
 * What a `view` step's `on[event]` handler may return: nothing, or `{ next }` — an external
 * event moves the cursor (a transition with `cause: 'event'` that runs `canEnter` / `exit` /
 * `enter` and skips input parsing / `validate` / `canExit`).
 * @public
 */
type ViewOnResult<N extends string> = void | undefined | {
  readonly next?: N | null | undefined;
};
/**
 * Return contract of a step-level `on[event]` handler by kind: `WaitOnResult` for waits,
 * `ViewOnResult` for views, `void` for tasks / decisions / flows / finals (they may `update()`
 * context, never redirect).
 * @public
 */
type OnResult<K extends StepKind, N extends string> = [K] extends ['wait'] ? WaitOnResult<N> : [K] extends ['view'] ? ViewOnResult<N> : void;
/**
 * Step-level `on` handlers, one per event the step listens for while ACTIVE (payload already
 * parsed by the flow's event boundary); `R` is the kind's return contract (`OnResult`).
 * @public
 */
type OnHandlers<C, Ev, D, R> = { readonly [E in keyof Ev]?: (a: EventArgs<C, D, Ev[E], E>) => MaybePromise<R>; };
/**
 * What a flow-level `on[event]` handler may return: nothing, or `{ cancel: reason }` to cancel
 * the flow (subject to the compensation policy).
 * @public
 */
type FlowOnResult = void | undefined | {
  readonly cancel: string;
};
/**
 * Flow-level `on` handlers (`defineFlow({ on })`): run after the step-level handlers of the
 * same event, in the same batch, whether or not a step handled it.
 * @public
 */
type FlowOnHandlers<C, Ev, D> = { readonly [E in keyof Ev]?: (a: FlowOnArgs<C, D, Ev[E], E>) => MaybePromise<FlowOnResult>; };
/**
 * Correlation extractors (`defineFlow({ correlate })`): per event, the correlation id of a
 * parsed payload (`undefined` = this payload carries none). An event whose id differs from the
 * wizard's `correlationId` (`createWizard(flow, { correlationId })`) is dropped
 * (`event.dropped { reason: 'correlation' }`), never buffered.
 * @public
 */
type CorrelateSpec<Ev> = { readonly [E in keyof Ev]?: (payload: Ev[E]) => string | undefined; };
//#endregion
//#region src/authoring/types/step.d.ts
/**
 * Phantom facts of a step: input (draft) type, output type, referenced ids, child flow and the
 * `mapError` value type (`E`, `never` without `mapError`).
 * @public
 */
interface StepTypes<I, O, N extends string, CF, E = never> {
  readonly input: I;
  readonly output: O;
  readonly refs: N;
  readonly child: CF;
  readonly error: E;
}
/**
 * Contravariant probe that records which context / events / deps a step is bound to; the
 * assembly check `T[K] extends { '~bound': BoundTo<C, Ev, D> | undefined }` accepts steps
 * written for a subset context / events / deps and rejects unrelated ones. Phantom only.
 * @public
 */
type BoundTo<C, Ev, D> = (args: BaseArgs<C, D>, events: Ev) => void;
/**
 * One step as returned by a constructor. `C` context, `Ev` event map, `D` deps, `I` raw input
 * (draft) type, `O` output type, `N` every step id literal this step references (phantom),
 * `K` kind, `CF` child flow, `E` the `mapError` value type (tasks; `never` otherwise). Every
 * config field is present (`undefined` when unset).
 * @public
 */
interface Step<C, Ev, D, I, O, N extends string, K extends StepKind, CF, E = never> {
  readonly kind: K;
  readonly '~types': StepTypes<I, O, N, CF, E> | undefined;
  readonly '~bound': BoundTo<C, Ev, D> | undefined;
  readonly label: string | undefined;
  readonly dependsOn: DependsOn<N> | undefined;
  readonly next: NextSpec<C, D, O, N> | undefined;
  /** Any kind (v0.2): external-event handlers while the step is active; return contract by kind. */
  readonly on: OnHandlers<C, Ev, D, OnResult<K, N>> | undefined;
  /** Any non-final kind (v0.2): skip predicate. */
  readonly when: WhenSpec<C, D> | undefined;
  readonly input: Boundary<O, I> | undefined;
  readonly initial: Partial<I> | undefined;
  readonly validate: ((a: OutputArgs<C, D, O>) => MaybePromise<void | undefined | readonly Issue$1[]>) | undefined;
  readonly canEnter: ((a: EnterArgs<C, D>) => MaybePromise<boolean>) | undefined;
  readonly canExit: ((a: OutputArgs<C, D, O>) => MaybePromise<boolean>) | undefined;
  readonly enter: ((a: EnterArgs<C, D>) => unknown) | undefined;
  readonly exit: ((a: ExitArgs<C, D, O>) => unknown) | undefined;
  readonly run: ((a: RunArgs<C, D>) => unknown) | undefined;
  readonly output: Boundary<O, unknown> | ((a: BaseArgs<C, D>) => O) | undefined;
  readonly retry: RetryPolicy | undefined;
  readonly timeout: Duration | {
    readonly after: Duration;
    readonly next: N;
  } | undefined;
  readonly compensate: ((a: CompensateArgs<C, D, O>) => unknown) | undefined;
  /** Task (v0.2): re-run after a crash instead of failing `interrupted`; a function supplies the key. */
  readonly idempotent: boolean | ((a: RunArgs<C, D>) => string) | undefined;
  /** Task (v0.2): maps a failure to the JSON-safe `error.data` (`ErrorOf<F, K>`). */
  readonly mapError: ((error: unknown, a: MapErrorArgs<C, D>) => MaybePromise<E>) | undefined;
  readonly child: CF | undefined;
  readonly context: ((a: BaseArgs<C, D>) => unknown) | undefined;
  readonly deps: ((a: BaseArgs<C, D>) => unknown) | undefined;
}
/**
 * What `Flow.steps[k]` is typed as: the per-step facts only (kind + phantom). `C`/`Ev`/`D` are
 * NOT repeated per step so a flow's printed type stays O(steps); every extractor reads only
 * `kind` and `'~types'`.
 * @public
 */
interface FlowStep<I, O, N extends string, K extends StepKind, CF, E = never> {
  readonly kind: K;
  readonly '~types': StepTypes<I, O, N, CF, E> | undefined;
}
/**
 * Compacts a constructor result to its `FlowStep`.
 * @public
 */
type CompactStep<S> = S extends {
  readonly kind: infer K extends StepKind;
  readonly '~types': StepTypes<infer I, infer O, infer N, infer CF, infer E> | undefined;
} ? FlowStep<I, O, N, K, CF, E> : never;
//#endregion
//#region src/authoring/types/step-config.d.ts
/**
 * `s.view` configuration. `I` / `O` are inferred from `input` ONLY (`NoInfer` everywhere else):
 * without `input` the view has no draft (`I = never`, `O = undefined`) and `initial` is rejected.
 * @public
 */
interface ViewCfg<C, Ev, D, I, O, N extends string> {
  readonly label?: string;
  /** Boundary for the draft input; the OUTPUT side is what hooks and `steps[k].output` see. */
  readonly input?: Boundary<O, I>;
  /** Initial draft (INPUT side, partial). Requires `input`. */
  readonly initial?: NoInfer<Partial<I>>;
  readonly validate?: (a: OutputArgs<C, D, NoInfer<O>>) => MaybePromise<void | undefined | readonly Issue$1[]>;
  readonly canEnter?: (a: EnterArgs<C, D>) => MaybePromise<boolean>;
  readonly canExit?: (a: OutputArgs<C, D, NoInfer<O>>) => MaybePromise<boolean>;
  readonly enter?: (a: EnterArgs<C, D>) => unknown;
  readonly exit?: (a: ExitArgs<C, D, NoInfer<O>>) => unknown;
  /** External-event handlers while the view is current; `{ next }` moves the cursor. */
  readonly on?: OnHandlers<C, Ev, D, ViewOnResult<N>>;
  readonly when?: WhenSpec<C, D>;
  readonly next?: NextSpec<C, D, NoInfer<O>, N>;
  readonly dependsOn?: DependsOn<N>;
}
/**
 * `s.task(run, options)` options. `E` (the `mapError` value type) is inferred from `mapError`.
 * @public
 */
interface TaskOptions<C, Ev, D, O, N extends string, E = never> {
  readonly label?: string;
  /** Optional re-check of the value returned by `run` (fixes the step's output type). */
  readonly output?: Boundary<O, unknown>;
  readonly retry?: RetryPolicy;
  readonly timeout?: Duration;
  readonly compensate?: (a: CompensateArgs<C, D, O>) => unknown;
  readonly enter?: (a: EnterArgs<C, D>) => unknown;
  readonly exit?: (a: ExitArgs<C, D, O>) => unknown;
  /** External-event handlers while the task runs (may `update()` context; return nothing). */
  readonly on?: OnHandlers<C, Ev, D, void>;
  readonly when?: WhenSpec<C, D>;
  /**
   * `true`: after a crash a `running` task is re-run on resume with the same idempotency key
   * (`args.idempotencyKey`, default `${instanceId}:${step}:${runId}`) instead of failing
   * `interrupted`; a function supplies the key.
   */
  readonly idempotent?: boolean | ((a: RunArgs<C, D>) => string);
  /** Map a failure (thrown value / rejection) to a JSON-safe value stored as `error.data`. */
  readonly mapError?: (error: unknown, a: MapErrorArgs<C, D>) => MaybePromise<E>;
  readonly next?: NextSpec<C, D, O, N>;
  readonly dependsOn?: DependsOn<N>;
}
/**
 * `s.wait` configuration. `T` is the phantom captured from `timeout` (`undefined` when absent)
 * that decides whether `WaitOutput` carries the `{ event: 'timeout' }` marker.
 * @public
 */
interface WaitCfg<C, Ev, D, N extends string, T = unknown> {
  readonly label?: string;
  /** One handler per event; `{ done }` overrides the output with a `WaitOutput` of this step. */
  readonly on: OnHandlers<C, Ev, D, WaitOnResult<N, NoInfer<WaitOutput<Ev, T>>>>;
  readonly timeout?: {
    readonly after: Duration;
    readonly next: N;
  } & T;
  readonly enter?: (a: EnterArgs<C, D>) => unknown;
  readonly exit?: (a: ExitArgs<C, D, WaitOutput<Ev, T>>) => unknown;
  readonly when?: WhenSpec<C, D>;
  readonly next?: NextSpec<C, D, WaitOutput<Ev, T>, N>;
  readonly dependsOn?: DependsOn<N>;
}
/**
 * `s.decision` configuration. The step's output is the normalized list of chosen targets
 * (`readonly N[]`: `'a'` → `['a']`, `null` → `[]`).
 * @public
 */
interface DecisionCfg<C, Ev, D, N extends string> {
  readonly label?: string;
  readonly next: (a: NextArgs<C, D, undefined>) => MaybePromise<NextRef<N>>;
  readonly on?: OnHandlers<C, Ev, D, void>;
  readonly when?: WhenSpec<C, D>;
  readonly dependsOn?: DependsOn<N>;
}
/**
 * `s.flow(child, cfg)` configuration.
 * @public
 */
interface FlowCfg<C, Ev, D, CF extends AnyFlow, O, N extends string> {
  readonly label?: string;
  /** Builds the child's context input (parsed ONCE by the child's context boundary at child creation). */
  readonly context: (a: BaseArgs<C, D>) => ContextInput<CF>;
  /**
   * Builds the child's deps (parsed by the child's `deps` boundary when it declares one, at
   * child creation); when omitted the parent's deps object is passed through unchanged.
   */
  readonly deps?: (a: BaseArgs<C, D>) => DepsOf<CF>;
  /** Optional re-check of the child's output (fixes the step's output type). */
  readonly output?: Boundary<O, unknown>;
  readonly exit?: (a: ExitArgs<C, D, O>) => unknown;
  readonly on?: OnHandlers<C, Ev, D, void>;
  readonly when?: WhenSpec<C, D>;
  readonly next?: NextSpec<C, D, O, N>;
  readonly dependsOn?: DependsOn<N>;
}
/**
 * `s.final` configuration.
 * @public
 */
interface FinalCfg<C, Ev, D, O> {
  readonly label?: string;
  readonly output?: (a: BaseArgs<C, D>) => O;
  readonly on?: OnHandlers<C, Ev, D, void>;
}
/**
 * Constructors pre-bound to `C`/`Ev`/`D`. Only `N` captures literals; no `const` params.
 * `I = never` means "this step has no draft input"; `O` is `undefined` (never `never`) when a
 * step has no output value. A view's `I`/`O` come from its `input` boundary only; a wait's
 * `T` phantom records whether it declares a `timeout`; a decision's output is `readonly N[]`;
 * a task's `E` is its `mapError` value type (`never` without `mapError`).
 * @public
 */
interface StepApi<C, Ev, D> {
  view<I = never, O = [I] extends [never] ? undefined : I, N extends string = never>(cfg: ViewCfg<C, Ev, D, I, O, N>): Step<C, Ev, D, I, O, N, 'view', never>;
  task<R, O = Awaited<R>, N extends string = never, E = never>(run: (a: RunArgs<C, D>) => R, options?: TaskOptions<C, Ev, D, O, N, E>): Step<C, Ev, D, never, O, N, 'task', never, E>;
  wait<N extends string = never, T = undefined>(cfg: WaitCfg<C, Ev, D, N, T>): Step<C, Ev, D, never, WaitOutput<Ev, [T] extends [undefined] ? undefined : true>, N, 'wait', never>;
  decision<N extends string>(cfg: DecisionCfg<C, Ev, D, N>): Step<C, Ev, D, never, readonly N[], N, 'decision', never>;
  flow<CF extends AnyFlow, O = FlowOutput<CF>, N extends string = never>(child: CF, cfg: FlowCfg<C, Ev, D, CF, O, N>): Step<C, Ev, D, never, O, N, 'flow', CF>;
  final<O = undefined>(cfg?: FinalCfg<C, Ev, D, O>): Step<C, Ev, D, never, O, never, 'final', never>;
}
//#endregion
//#region src/authoring/types/flow.d.ts
/**
 * Ids a step references (phantom `refs`).
 * @public
 */
type RefsOf<S> = S extends {
  readonly '~types': infer P;
} ? NonNullable<P> extends {
  readonly refs: infer R;
} ? R : never : never;
/**
 * `T & ValidateSteps<T, C, Ev, D>`: naked `T` wins inference; a failing key evaluates to an
 * object with a `'~error'` message property that no Step has, so the error lands on that
 * step's property line and never cascades into `T`. The `'~bound'` probe checks that every
 * step is bound to this flow's context/events/deps (module variance).
 *
 * IMPORTANT (ADR-001 F1): `T` must NOT be constrained; the homomorphic mapped type below has no
 * visible members while `T` is generic, so it cannot poison inference.
 * @public
 */
type ValidateSteps<T, C, Ev, D> = { readonly [K in keyof T]: [RefsOf<T[K]>] extends [Ids<T>] ? T[K] extends {
  readonly '~bound': BoundTo<C, Ev, D> | undefined;
} ? unknown : {
  readonly '~error': `step '${K & string}' is bound to a different context/events/deps than this flow`;
} : {
  readonly '~error': `step '${K & string}' references unknown step id(s): '${Exclude<RefsOf<T[K]>, Ids<T>> & string}'`;
}; };
/**
 * Rejects steps maps with dynamic (index-signature) keys — every id must be a literal.
 * @public
 */
type NoDynamicKeys<T> = string extends keyof T ? {
  readonly '~error': 'steps must be declared with literal keys';
} : unknown;
/**
 * The full assembly check applied by `FlowBuilder.steps`.
 * @public
 */
type CheckSteps<T, C, Ev, D> = ValidateSteps<T, C, Ev, D> & NoDynamicKeys<T>;
/**
 * Phantom facts of a flow.
 * @public
 */
interface FlowTypes<C, CIn, Ev, D, T> {
  readonly ctx: C;
  readonly ctxIn: CIn;
  readonly events: Ev;
  readonly deps: D;
  readonly steps: T;
}
/**
 * Flow-level policies.
 * @public
 */
interface FlowOptions {
  /** What happens when a task fails with no retries left. Default `'halt'`. */
  readonly onFailure?: 'halt' | 'compensate';
  /** Default retry policy for tasks. */
  readonly retry?: RetryPolicy;
  /** Ready non-view steps start automatically (`'ready'`, default) or via `runReady()` (`'manual'`). */
  readonly autoRun?: 'ready' | 'manual';
  /** Maximum concurrently running tasks. Default `Infinity`. */
  readonly concurrency?: number;
  /** Events with no active listener: buffer them (default `true`) for `ttl` (default `'5m'`). */
  readonly unmatchedEvents?: {
    readonly buffer: boolean;
    readonly ttl: Duration;
  };
}
/**
 * A defined flow. `T` is the COMPACT steps map (`{ [id]: FlowStep<…> }`); the runtime object
 * holds the full step records (with hooks).
 * @public
 */
interface Flow<C, CIn, Ev, D, T> extends FlowOptions {
  readonly '~types': FlowTypes<C, CIn, Ev, D, T> | undefined;
  readonly name: string;
  readonly version?: number;
  readonly context: Boundary<C, CIn>;
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown>; };
  readonly deps?: Boundary<D, unknown>;
  /**
   * Flow-level `on` handlers by event (`defineFlow({ on })`), stored as opaque functions so the
   * flow type stays covariant in its context; the typed contract is `FlowDefinition.on`.
   */
  readonly on?: { readonly [E in keyof Ev]?: (args: never) => unknown; };
  /** Correlation extractors by event (`defineFlow({ correlate })`); stored opaquely like `on`. */
  readonly correlate?: { readonly [E in keyof Ev]?: (payload: never) => string | undefined; };
  readonly steps: T;
  /** Entry step(s): one id, or several for a flow with more than one entry point (default: the first step). */
  readonly start?: Ids<T> | readonly Ids<T>[];
}
/**
 * The steps map every flow satisfies (an index of `FlowStep`s); the interface breaks the
 * `AnyFlow` ↔ child-flow reference cycle.
 * @public
 */
interface AnyFlowSteps {
  readonly [id: string]: FlowStep<unknown, unknown, string, StepKind, AnyFlow, unknown>;
}
/**
 * Any flow — the constraint of every extractor and of `Wizard<F>`; `any`-free (a flow's
 * `'~types'`/`steps`/boundaries are covariant, so every concrete `Flow` is assignable).
 * @public
 */
type AnyFlow = Flow<unknown, unknown, Record<string, unknown>, unknown, AnyFlowSteps>;
/**
 * `defineFlow(options)` header: name/version, boundaries and policies.
 * @public
 */
type FlowDefinition<C, CIn, Ev, D> = FlowOptions & {
  /** Persistence identity together with `version`. Required. */
  readonly name: string;
  readonly version?: number;
  /** Context boundary (`boundary.trusted<C>()` for unvalidated defaults). */
  readonly context: Boundary<C, CIn>;
  /** External event boundaries; `Ev` is inferred by reverse mapping. */
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown>; };
  /** Injected dependencies boundary (usually `boundary.trusted<D>()`). */
  readonly deps?: Boundary<D, unknown>;
  /**
   * Flow-level event handlers, run after the step-level ones of the same event in the same
   * batch; a handler may return `{ cancel: reason }`. (`NoInfer`: `Ev` comes from `events` only.)
   */
  readonly on?: NoInfer<FlowOnHandlers<C, Ev, D>>;
  /**
   * Correlation extractors: with `createWizard(flow, { correlationId })`, an event whose
   * extracted id differs is dropped (`event.dropped { reason: 'correlation' }`), never buffered.
   */
  readonly correlate?: NoInfer<CorrelateSpec<Ev>>;
};
/**
 * What `defineFlow(options)` returns: the pre-bound constructors plus `steps()`.
 * @public
 */
interface FlowBuilder<C, CIn, Ev, D> extends StepApi<C, Ev, D> {
  /**
   * Assemble the flow. `start` defaults to the first declared step. Every referenced id is
   * checked at compile time (`'~error'` on the offending step property) and at runtime.
   */
  steps<T>(steps: T & CheckSteps<T, C, Ev, D>, opts?: {
    readonly start?: NoInfer<Ids<T> | readonly Ids<T>[]>;
  }): Flow<C, CIn, Ev, D, { readonly [K in keyof T]: CompactStep<T[K]>; }>;
}
//#endregion
//#region src/authoring/types/extractors.d.ts
/**
 * Parsed context type of a flow (boundary OUTPUT side).
 * @public
 */
type Ctx<F extends AnyFlow> = NonNullable<F['~types']>['ctx'];
/**
 * Context input type of a flow (boundary INPUT side — what `createWizard` accepts).
 * @public
 */
type ContextInput<F extends AnyFlow> = NonNullable<F['~types']>['ctxIn'];
/**
 * Deps type of a flow (`unknown` when the flow declares no `deps` boundary).
 * @public
 */
type DepsOf<F extends AnyFlow> = NonNullable<F['~types']>['deps'];
/**
 * Event map of a flow (`{ [event]: payload }`).
 * @public
 */
type EventMapOf<F extends AnyFlow> = NonNullable<F['~types']>['events'];
/**
 * Declared event names of a flow.
 * @public
 */
type EventType<F extends AnyFlow> = Extract<keyof EventMapOf<F>, string>;
/**
 * Parsed payload type of one event.
 * @public
 */
type PayloadOf<F extends AnyFlow, E extends EventType<F>> = EventMapOf<F>[E];
/**
 * Step ids of a flow.
 * @public
 */
type StepId<F extends AnyFlow> = Extract<keyof F['steps'], string>;
/**
 * Phantom facts of one step.
 * @public
 */
type StepTypesOf<F extends AnyFlow, K extends StepId<F>> = NonNullable<F['steps'][K]['~types']>;
/**
 * Raw input (draft, INPUT side of the view's `input` boundary) type of a step; `never` without a draft.
 * @public
 */
type InputOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['input'];
/**
 * Draft patch type of a view (`Partial` of the INPUT side) — what `setInput` accepts.
 * @public
 */
type DraftOf<F extends AnyFlow, K extends StepId<F>> = Partial<InputOf<F, K>>;
/**
 * Output type of a step: parsed input (view), run result (task), `{ event, payload }` (wait),
 * child output (flow), `output()` result (final); `undefined` when the step has none.
 * @public
 */
type OutputOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['output'];
/**
 * Child flow of a `flow` step (`never` for other kinds).
 * @public
 */
type ChildFlowOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['child'];
/**
 * Mapped error type of a task (`s.task(run, { mapError })` → the value stored as
 * `steps[k].error.data`); `never` for steps without `mapError`.
 * @public
 */
type ErrorOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['error'];
/**
 * Kind of a step.
 * @public
 */
type KindOf<F extends AnyFlow, K extends StepId<F>> = F['steps'][K]['kind'];
/**
 * `true` when step `K` is exactly of kind `Kind` — or when its kind is the fully widened
 * `StepKind` (a wildcard flow such as `AnyFlow`, where every id is a `string` anyway). A step
 * whose kind is a partial union (`'view' | 'task'`) is NOT of either kind (safe direction).
 * @public
 */
type HasKind<F extends AnyFlow, K extends StepId<F>, Kind extends StepKind> = [KindOf<F, K>] extends [Kind] ? true : [StepKind] extends [KindOf<F, K>] ? true : false;
/**
 * Ids of the view steps (`go`, `setInput`, `resetInput`, `validate` accept these).
 * @public
 */
type ViewId<F extends AnyFlow> = { [K in StepId<F>]: HasKind<F, K, 'view'> extends true ? K : never; }[StepId<F>];
/**
 * Ids of the task steps (`retry`, `run` accept these).
 * @public
 */
type TaskId<F extends AnyFlow> = { [K in StepId<F>]: HasKind<F, K, 'task'> extends true ? K : never; }[StepId<F>];
/**
 * Ids of the `flow` steps (`child()` accepts these).
 * @public
 */
type ChildStepId<F extends AnyFlow> = { [K in StepId<F>]: [ChildFlowOf<F, K>] extends [never] ? never : K; }[StepId<F>];
/**
 * Output type of a flow: the union of its `final` steps' outputs.
 * @public
 */
type FlowOutput<F extends AnyFlow> = { [K in StepId<F>]: HasKind<F, K, 'final'> extends true ? OutputOf<F, K> : never; }[StepId<F>];
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
//#region src/authoring/define-flow.d.ts
/**
 * Start a flow definition: `const s = defineFlow({ name, context, events?, deps?, …policies })`,
 * then `s.steps({ a: s.view({…}), … }, { start: 'a' })`. Every constructor is pre-bound to
 * the flow's context, events and deps, so hooks are typed without generics.
 * @public
 */
declare function defineFlow<C, CIn, Ev = {}, D = unknown>(options: FlowDefinition<C, CIn, Ev, D>): FlowBuilder<C, CIn, Ev, D>;
//#endregion
//#region src/errors.d.ts
/**
 * Stable error codes carried by `WizardError` and by `{ ok: false }` results.
 *
 * @public
 */
type WizardErrorCode = 'UNKNOWN_STEP' | 'UNKNOWN_EVENT' | 'NOT_A_VIEW' | 'NOT_A_TASK' | 'NOT_A_FLOW_STEP' | 'NOT_ACTIVE' | 'NOT_REACHABLE' | 'NAV_BUSY' | 'NO_TARGET' | 'NO_HISTORY' | 'INVALID_INPUT' | 'BOUNDARY_REJECTED' | 'GUARD_BLOCKED' | 'FLOW_TERMINAL' | 'FLOW_NOT_STARTED' | 'INVALID_COMMAND' | 'SYNC_VIOLATION' | 'SNAPSHOT_INCOMPATIBLE' | 'SNAPSHOT_NOT_SERIALIZABLE' | 'NESTING_CYCLE' | 'NESTING_TOO_DEEP' | 'DEFINITION_INVALID' | 'DISPOSED';
/**
 * Error thrown for programmer errors (misuse of the API): unknown event names,
 * incompatible snapshots, invalid definitions, disposed wizards. Data problems
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
//#region src/authoring/compile/index.d.ts
/**
 * A static-analysis warning about a flow (advisory; never thrown).
 * @public
 */
interface FlowWarning {
  readonly code: 'UNREACHABLE' | 'NEVER_ACTIVATES' | 'NAV_CYCLE';
  readonly message: string;
  /** Step the warning is about. */
  readonly step?: string;
  /** Wizard path of the flow the step belongs to (`[]` = root). */
  readonly path: readonly string[];
}
//#endregion
//#region src/inspect/graph.d.ts
/**
 * One step of the graph. `path` is the wizard path of the flow the step belongs to
 * (`[]` = root, `['fulfil']` = inside the child of step `fulfil`), so ids never collide across
 * nesting levels. `dynamicNext` marks a step whose successors are only known at runtime.
 * @public
 */
interface FlowGraphNode {
  readonly id: string;
  readonly kind: StepKind;
  readonly label?: string;
  readonly path: readonly string[];
  /**
   * Hooks the step defines, by their AUTHORING names (`enter`, `run`, `when`, `mapError`,
   * `on:payment.captured`, a flow step's `context` / `deps` / `output` mappers, a final's
   * `output`, a task's `idempotent` key function, …).
   */
  readonly hooks: readonly string[];
  readonly dependsOn?: DepsSpec;
  /** Task timeout or wait timeout, in ms. */
  readonly timeout?: number;
  readonly dynamicNext?: true;
  /** The step is an entry point of its flow. */
  readonly start?: true;
}
/**
 * A static edge between two steps of the same flow (`path`). `start` edges have no `from`.
 * @public
 */
interface FlowGraphEdge {
  readonly from: string | null;
  readonly to: string;
  readonly kind: 'next' | 'dependsOn' | 'timeout' | 'start';
  readonly path: readonly string[];
}
/**
 * The static graph of a flow: nodes, edges and analysis warnings (recursively for child flows).
 * @public
 */
interface FlowGraph {
  readonly name: string;
  readonly version: number;
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  readonly warnings: readonly FlowWarning[];
}
/**
 * Build the static graph of a flow (compiles it if needed; throws `DEFINITION_INVALID` for a
 * broken flow). Warnings: `UNREACHABLE`, `NEVER_ACTIVATES`, `NAV_CYCLE`.
 * @public
 */
declare function inspect(flow: AnyFlow): FlowGraph;
//#endregion
//#region src/inspect/mermaid.d.ts
/**
 * Render a `FlowGraph` as Mermaid (`flowchart TD`): nodes `id (kind)`, `next` edges, labelled
 * `dependsOn` edges, dashed labelled `timeout` edges, dynamic `next` as a dashed edge to a `?`
 * node, child flows as subgraphs. Deterministic for a given graph.
 * @public
 */
declare function toMermaid(graph: FlowGraph): string;
//#endregion
//#region src/persistence/store.d.ts
/**
 * Store — the persistence port. One snapshot per key; the value is whatever
 * `toSnapshot()` produced (after `redact`, if configured), JSON-checked right
 * before `set` (a write of a non-JSON snapshot never reaches the store —
 * `onPersistError` / `persist.failed`). Single-owner in v0.1: one live wizard
 * per key, no compare-and-swap or lease.
 *
 * Implementations are the host's job (Redis, Postgres, KV, ...); core ships
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
//#region src/interpreter/env.d.ts
/**
 * Wall clock the runtime reads for timestamps and timer deadlines (`createWizard({ clock })`).
 * @public
 */
interface Clock {
  /** Monotonic-enough wall clock in ms. */
  now(): number;
}
/**
 * Timer scheduler the runtime arms retries, wait timeouts and inbox TTLs with
 * (`createWizard({ scheduler })`). Handles are opaque: the runtime only ever passes them back
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
//#region src/machine/events.d.ts
interface Envelope {
  /** Monotonic per wizard instance. */
  readonly seq: number;
  /** `clock.now()` when applied. */
  readonly at: number;
  /** Path of the wizard that produced the event: [] for the root, ['fulfil'] for a child. */
  readonly path: readonly string[];
  /** seq of the causing event, if any (effect results reference the event that planned the effect). */
  readonly causedBy?: number;
  /** Optional wall-clock duration for hook results. */
  readonly durationMs?: number;
}
type DomainEventBody = {
  readonly type: 'flow.started';
  readonly start: string;
} | {
  readonly type: 'flow.done';
  readonly output?: unknown;
} | {
  readonly type: 'flow.failed';
  readonly step?: string;
  readonly error: SerializedError$1;
  readonly code?: 'AUTO_ADVANCE_LOOP' | 'STEP_FAILED' | 'CHILD_FAILED';
} |
/** `outcome` = what `flow.compensated` will report ('cancelled' when triggered by `cancel`, else 'failed'). */
{
  readonly type: 'flow.compensating';
  readonly reason?: string;
  readonly plan: readonly string[];
  readonly outcome?: 'failed' | 'cancelled';
} | {
  readonly type: 'flow.compensated';
  readonly failures: readonly string[];
  readonly outcome: 'failed' | 'cancelled';
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
  readonly status: WizardStatus$1;
} | {
  readonly type: 'transition.started';
  readonly txId: string;
  readonly from: string | null;
  readonly to?: string;
  readonly cause: NavCause;
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
  readonly to: string;
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
/** `next` = auto-advance target override (wait handler `{ next }`, `waitTimeout.next`). */
{
  readonly type: 'step.done';
  readonly step: string;
  readonly output?: unknown;
  readonly next?: string;
} |
/** `data` (v0.2) = the task's `mapError` value for this failure. */
{
  readonly type: 'step.failed';
  readonly step: string;
  readonly error: SerializedError$1;
  readonly kind: 'run' | 'timeout' | 'hook' | 'child' | 'sync-violation' | 'interrupted';
  readonly data?: unknown;
} | {
  readonly type: 'step.skipped';
  readonly step: string;
  readonly reason?: string;
} |
/** v0.2: the step's `when` predicate is being evaluated (it is ready; `apply` marks `when: 'pending'`). */
{
  readonly type: 'step.whenStarted';
  readonly step: string;
} |
/** v0.2: `when` resolved — `ok: false` is followed by `step.skipped { reason: 'when' }`. */
{
  readonly type: 'step.whenEvaluated';
  readonly step: string;
  readonly ok: boolean;
} |
/** v0.2: explicit invalidation (never automatic). */
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
/** v0.2: the task's `idempotencyKey` hook is being called; `step.runStarted` follows with its value. */
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
  /** v0.2: true when an idempotent task is re-run after a crash/resume. */
  readonly resumed?: boolean;
} | {
  readonly type: 'step.runSucceeded';
  readonly step: string;
  readonly attempt: number;
  readonly output: unknown;
} |
/**
 * v0.2: an attempt failed and the task's `mapError` hook is being called before the failure is
 * recorded (`step.runFailed { data }` follows). Carries the raw failure so `plan` can build the call.
 */
{
  readonly type: 'step.mapErrorStarted';
  readonly step: string;
  readonly attempt: number;
  readonly error: SerializedError$1;
  readonly timedOut?: boolean;
  readonly syncViolation?: boolean;
} |
/** `data` (v0.2) = the task's `mapError` value for this attempt's failure. */
{
  readonly type: 'step.runFailed';
  readonly step: string;
  readonly attempt: number;
  readonly error: SerializedError$1;
  readonly willRetry: boolean;
  readonly timedOut?: boolean;
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
} | {
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
/** `reason`: `'no-listener'`, or `'correlation'` (v0.2: `correlate[event](payload)` ≠ the wizard's `correlationId`). */
{
  readonly type: 'event.dropped';
  readonly event: string;
  readonly reason: string;
} |
/** v0.2: delivered to the flow-level `on[event]` handler (`plan` → `call { hook: 'flowOn' }`), after step deliveries. */
{
  readonly type: 'event.flowDelivered';
  readonly event: string;
  readonly inboxId: string;
  readonly payload?: unknown;
} |
/**
 * v0.2: a step handler returned something its kind cannot honour and it was ignored — `reason`:
 * `'kind'` (task/decision/flow/final returned `next`/`keep`/`done`/`fail`; a view returned
 * `keep`/`done`/`fail`) or `'nav-busy'` (a view returned `{ next }` while a transition was in flight).
 */
{
  readonly type: 'event.handlerResultIgnored';
  readonly step: string;
  readonly event: string;
  readonly reason: 'kind' | 'nav-busy';
} |
/**
 * v0.2: an `on[event]` handler threw. Wait handlers fail their step instead (v0.1 rule); this is
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
  readonly purpose: 'retry' | 'waitTimeout' | 'inboxTtl' | 'compensationGrace';
  readonly step?: string;
} | {
  readonly type: 'timer.fired';
  readonly timerId: string;
} | {
  readonly type: 'timer.cleared';
  readonly timerId: string;
} |
/** `childPath` = the child's wizard path (`[...path, step]`; `path` is the envelope field). `context` = value returned by `childContext` (input for `child.create`). */
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
  readonly command: Command$1;
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
type TransitionRejectReason = 'nav-busy' | 'not-a-view' | 'not-active' | 'not-reachable' | 'validation' | 'guard-canExit' | 'guard-canEnter' | 'no-target' | 'no-history' | 'flow-terminal' | 'flow-not-started' | 'flow-compensating' | 'resumed' | 'auto-advance-loop';
type DomainEvent = Envelope & DomainEventBody;
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
  readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING';
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
  readonly to: string;
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
 * wizard was disposed while the transition was in flight (`code: 'DISPOSED'`).
 */
{
  readonly ok: false;
  readonly reason: 'failed';
  readonly code: WizardErrorCode | 'HOOK_FAILED';
  readonly message: string;
  readonly step?: string;
  readonly error?: SerializedError$1;
};
/**
 * Result of `send(event, payload)`: delivered/buffered, rejected by the event boundary
 * (`code: 'BOUNDARY_REJECTED'`, with the boundary's `issues`), or dropped — nothing was waiting
 * for the event and it was not buffered (`code: 'NOT_ACTIVE'`), the machine refused it
 * (`FLOW_TERMINAL` / `FLOW_NOT_STARTED` / `FLOW_COMPENSATING`, …) or the wizard was disposed
 * (`DISPOSED`). Every `{ ok: false }` result carries `code` + `message`, like `CommandResult`;
 * `dispatch({ type: 'send' })` returns the same `code` as a `CommandResult`.
 *
 * @public
 */
type SendResult = {
  readonly ok: true;
  readonly delivered: readonly string[];
  readonly buffered: boolean;
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
//#endregion
//#region src/machine/explain.d.ts
interface Explanation$1 {
  readonly status: StepStatus$1 | 'unknown';
  readonly phase: StepPhase$1 | undefined;
  readonly reasons: readonly string[];
  readonly candidates: readonly string[];
}
//#endregion
//#region src/wizard/runtime/types.d.ts
/**
 * v0.2 (§9.5): rewrite a snapshot persisted by an older flow version. Called only when the
 * snapshot's `flow.version` differs from the flow's (a `flow.name` mismatch is always
 * incompatible); the result is validated like any snapshot and must carry the flow's version.
 * May return a promise — then only `resumeWizardAsync` accepts it.
 */
type SnapshotMigration$1 = (snapshot: unknown, from: {
  readonly name: string;
  readonly version: number;
}) => unknown;
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
/**
 * A command addressed to a nested flow: `path: [flowStep]` with a `Command` of that child, or a
 * longer path (`[flowStep, grandChildStep, …]`) whose `command` is typed for the flow at its end
 * — the flattened form of nesting `child` commands. For a wildcard flow or beyond the depth
 * budget (8 child levels) it is `AnyChildCommand` (ids widen to `string`).
 * @public
 */
type ChildCommand<F extends AnyFlow, Depth extends number = 8> = [Depth] extends [never] ? AnyChildCommand : string extends ChildStepId<F> ? AnyChildCommand : { [K in ChildStepId<F>]: {
  readonly type: 'child';
  readonly path: readonly [K];
  readonly command: Command<ChildFlowOf<F, K>, CommandDepthPrev[Depth]>;
} | (ChildCommand<ChildFlowOf<F, K>, CommandDepthPrev[Depth]> extends (infer Inner) ? Inner extends {
  readonly path: infer P extends readonly string[];
  readonly command: infer C;
} ? {
  readonly type: 'child';
  readonly path: readonly [K, ...P];
  readonly command: C;
} : never : never); }[ChildStepId<F>];
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
} | {
  readonly type: 'run';
  readonly step: TaskId<F>;
} | {
  readonly type: 'runReady';
} | {
  readonly type: 'retry';
  readonly step: TaskId<F>;
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
 * `kind`, `at`, `attempt?`, `issues?` and — for a task with `mapError` — `data` (`ErrorOf<F, K>`).
 * @public
 */
type StepErrorOf<F extends AnyFlow, K extends StepId<F>> = Omit<StepError, 'data'> & {
  readonly data?: ErrorOf<F, K>;
};
/**
 * Typed view of one step's stored record: `input` is the draft (`DraftOf`), `output` the
 * step's `OutputOf`, `error` its `StepErrorOf` (with `data` for a `mapError` task); everything
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
 * The versioned, JSON-safe snapshot of a wizard (what `getSnapshot()` returns, what a `Store`
 * persists and what `resumeWizard` accepts). `state` is the typed view of the wizard state;
 * `children` hold the snapshots of live child flows keyed by flow-step id.
 * @public
 */
interface Snapshot<F extends AnyFlow> {
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
type WithPath<T, P extends readonly string[]> = T extends unknown ? Omit<T, 'path'> & {
  readonly path: P;
} : never;
/**
 * A domain event of the wizard's OWN flow (`path` is `[]`), typed by the flow: `step` is a
 * `StepId<F>`, `event` an `EventType<F>`.
 * @public
 */
type RootWizardEvent<F extends AnyFlow = AnyFlow> = WithPath<RetypeEvent<RetypeStep<DomainEvent, F>, F>, readonly []>;
/**
 * A domain event forwarded from a child flow (`path.length > 0`, the child's wizard path): step
 * ids and event names are the child's, typed as `string`. Narrow with `isChildEvent(event)`.
 * @public
 */
type ChildWizardEvent = WithPath<DomainEvent, readonly [string, ...string[]]>;
/**
 * A domain event of a wizard (`observe()` / `log()`): either an event of its own flow, typed by
 * `F` (`RootWizardEvent<F>`, `path: []`), or one forwarded from a child flow
 * (`ChildWizardEvent`, `path: [step, …]`, ids as `string`). TypeScript does not narrow on
 * `event.path.length`; use `isChildEvent(event)` to split the two.
 * @public
 */
type WizardEvent<F extends AnyFlow = AnyFlow> = RootWizardEvent<F> | ChildWizardEvent;
/**
 * True for events forwarded from a child flow (`event.path.length > 0`); narrows a
 * `WizardEvent<F>` to `ChildWizardEvent` (and, in the other branch, to `RootWizardEvent<F>`).
 * @public
 */
declare function isChildEvent(event: WizardEvent): event is ChildWizardEvent;
/**
 * Result of `wizard.explain(step)`: the step's stored `status` (`'unknown'` for an unknown id),
 * its live `phase` (`undefined` when it has none), stable `reasons` codes explaining why it is
 * (not) where you expect (`flow-not-started`, `nav-busy`, `not-activated`, `deps-unmet:<id>`,
 * `guard-false:canEnter`, `concurrency-limit`, `auto-run-manual`, `failed:<kind>`,
 * `not-current`, `entering`, `retrying`, …) and the ready views the cursor could move to.
 * @public
 */
type Explanation<F extends AnyFlow = AnyFlow> = Omit<Explanation$1, 'candidates'> & {
  readonly candidates: readonly ViewId<F>[];
};
//#endregion
//#region src/wizard/create-wizard/wizard.d.ts
/**
 * A live wizard instance, typed by its flow. Navigation returns `NavResult`, everything else a
 * `CommandResult` / `SendResult`; nothing throws for data problems.
 * @public
 */
interface Wizard<F extends AnyFlow> {
  /** Instance id (also the default store key). */
  readonly id: string;
  /** Increments on every resume. */
  readonly epoch: number;
  /** The flow this wizard runs. */
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
  /** External event through the flow's event boundary (payload is untrusted). */
  send<E extends EventType<F>>(event: E, payload: unknown, options?: {
    readonly correlationId?: string;
  }): Promise<SendResult>;
  /** Run one ready task now (`autoRun: 'manual'`, or a task waiting on `dependsOn`). */
  run(step: TaskId<F>): Promise<CommandResult>;
  /** Re-run a failed task (`attempt` resets). */
  retry(step: TaskId<F>): Promise<CommandResult>;
  cancel(reason?: string): Promise<CommandResult>;
  /** Start ready non-view steps when `autoRun: 'manual'`. */
  runReady(): Promise<CommandResult>;
  compensate(options?: {
    readonly from?: StepId<F>;
    readonly reason?: string;
  }): Promise<CommandResult>;
  /** Back to the initial state (`flow.reset`): steps idle, timers cleared, children disposed; the instance id stays. */
  reset(): Promise<CommandResult>;
  /**
   * Skip a ready-or-active non-final step explicitly (`step.skipped { reason: 'command' }`): it
   * counts as done for `dependsOn` and its `next` targets are arrived; an active task is
   * cancelled first; a view must be ready or current (the current view exits without validation).
   */
  skip(step: StepId<F>, reason?: string): Promise<CommandResult>;
  /**
   * Return a `done` / `failed` / `skipped` step to `idle` (`step.invalidated`): a view keeps its
   * draft, the output moves to `previousOutput`, and with `cascade` (default `true`) every
   * transitive `dependsOn` dependent that is done / failed / skipped follows (running ones are
   * cancelled). Never automatic; rejected for an active step or the current view (`INVALID_COMMAND`).
   */
  invalidate(step: StepId<F>, options?: {
    readonly cascade?: boolean;
  }): Promise<CommandResult>;
  /**
   * The one wire door, typed by the flow (`Command<F>`); never throws for data problems.
   * Untrusted input (a request body) goes through `parseCommand(flow, input)` first.
   */
  dispatch(command: Command<F>): Promise<CommandResult>;
  /**
   * Hook an external event source (a queue consumer, an `EventTarget`, a socket) to `send`:
   * `source` receives the wizard's typed `send` and returns its own teardown, which runs when
   * the returned function is called or when the wizard is disposed.
   */
  attach(source: (send: Wizard<F>['send']) => () => void): () => void;
  getState(): Snapshot<F>['state'];
  /** Versioned, JSON-safe snapshot including live children; cached per state. */
  getSnapshot(): Snapshot<F>;
  /**
   * Pure query: why a step is (not) where you expect — status, live phase, stable reason codes
   * and the ready views the cursor could move to. Never throws (an unknown id yields
   * `status: 'unknown'`); safe to call after `dispose()`.
   */
  explain(step: StepId<F>): Explanation<F>;
  /** Pure query: `{ done, total, ratio }` over the non-final steps (`skipped` counts as done). */
  progress(): Progress;
  /** Pure query: the views that are ready or current (where the cursor is or could go). */
  readyViews(): readonly ViewId<F>[];
  /** State listeners: once per committed batch. */
  subscribe(listener: (state: Snapshot<F>['state']) => void): () => void;
  /** Event listeners: every event of this wizard and its children (`event.path`). */
  observe(listener: (event: WizardEvent<F>) => void): () => void;
  /** Bounded event ring (default 200). */
  log(): readonly WizardEvent<F>[];
  /** Live nested wizard of a `flow` step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`). */
  child<K extends ChildStepId<F>>(step: K): Wizard<ChildFlowOf<F, K>>;
  /**
   * Client-safe state through a projection defined for THIS flow object — a deny-by-default
   * `expose` projection (`ClientState<F, E>`) or a `select` projection (its return type)
   * (`WizardError('DEFINITION_INVALID')` for a projection of any other flow, same name or not).
   */
  project<S>(projection: Projection<F, S>): S;
  /** Write a snapshot now (no-op without a store). */
  save(): Promise<void>;
  dispose(): void;
}
type DepsOption<F extends AnyFlow> = unknown extends DepsOf<F> ? {
  readonly deps?: DepsOf<F>;
} : {
  readonly deps: DepsOf<F>;
};
/**
 * `createWizard` options: the context input (parsed by the flow's context boundary), `deps`
 * (required iff the flow declares a deps boundary), persistence and injectables.
 * @public
 */
type WizardOptions<F extends AnyFlow> = {
  readonly context: ContextInput<F>;
  readonly instanceId?: string;
  /**
   * Correlation id of this instance (`defineFlow({ correlate })`): a delivered event whose
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
  /** Turn the first thenable returned by a hook into a `SYNC_VIOLATION` failure. */
  readonly strict?: 'sync';
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number;
} & DepsOption<F>;
/**
 * Snapshot migration (`resumeWizard(flow, snapshot, { migrate })`): called with the raw
 * snapshot when its `flow.version` differs from the flow's, and the flow identity (`from`);
 * returns the converted snapshot, which is validated like any other (its `flow.version` must
 * equal the flow's, else `SNAPSHOT_INCOMPATIBLE`). `flow.name` must always match. May return
 * a promise — then only `resumeWizardAsync` accepts it.
 * @public
 */
type SnapshotMigration = SnapshotMigration$1;
/** The options shared by creation and resume (persistence, injectables, deps). */
type SharedOptions<F extends AnyFlow> = Omit<WizardOptions<F>, 'context' | 'instanceId' | 'correlationId'>;
/**
 * `resumeWizard` options: `WizardOptions` without `context` / `instanceId` / `correlationId`
 * (they come from the snapshot), plus `migrate` for snapshots of an older flow `version`.
 * @public
 */
type ResumeOptions<F extends AnyFlow> = SharedOptions<F> & {
  readonly migrate?: SnapshotMigration;
};
//#endregion
//#region src/wizard/create-wizard/index.d.ts
/**
 * Create a wizard from a flow: parses `context` (and `deps`) through the flow's boundaries
 * synchronously (async boundaries → use `createWizardAsync`), compiles the flow and starts a
 * runtime. Call `start()` to activate the entry step(s).
 * @public
 */
declare function createWizard<F extends AnyFlow>(flow: F, options: WizardOptions<F>): Wizard<F>;
/**
 * Like `createWizard`, for flows whose context / deps boundaries are asynchronous.
 * @public
 */
declare function createWizardAsync<F extends AnyFlow>(flow: F, options: WizardOptions<F>): Promise<Wizard<F>>;
/**
 * Resume a wizard from a persisted snapshot: the envelope, flow identity, step set and every
 * boundary are re-validated (`WizardError('SNAPSHOT_INCOMPATIBLE')` lists every reason);
 * `epoch` increments; interrupted work follows the recovery matrix. A snapshot of another flow
 * `version` goes through `options.migrate` first (else `SNAPSHOT_INCOMPATIBLE`).
 * @public
 */
declare function resumeWizard<F extends AnyFlow>(flow: F, snapshot: unknown, options: ResumeOptions<F>): Wizard<F>;
/**
 * Like `resumeWizard`, for flows with asynchronous boundaries (context, deps, view inputs, task
 * / flow outputs, event payloads): every boundary is awaited BEFORE any runtime is constructed,
 * so resume stays atomic (`SNAPSHOT_INCOMPATIBLE` lists every reason, nothing runs on failure).
 * @public
 */
declare function resumeWizardAsync<F extends AnyFlow>(flow: F, snapshot: unknown, options: ResumeOptions<F>): Promise<Wizard<F>>;
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
 * `error` (with the `mapError` `data`), and — flow steps only — `child`: `true` for the compact
 * `ChildSummary`, or a nested (deny-by-default) spec for the projected child state. Nothing is
 * exposed by default.
 * @public
 */
type StepExpose<F extends AnyFlow, K extends StepId<F>> = {
  readonly input?: boolean;
  readonly output?: boolean;
  readonly issues?: boolean;
  readonly error?: boolean;
} & ([ChildFlowOf<F, K>] extends [never] ? {} : {
  readonly child?: boolean | ExposeSpec<ChildFlowOf<F, K>>;
});
/**
 * What a projection exposes: per-step flags, the context keys that cross the wire, whether the
 * flow `output` does (`output: true`) and whether `progress` does (`progress: true`).
 * @public
 */
interface ExposeSpec<F extends AnyFlow> {
  readonly steps?: { readonly [K in StepId<F>]?: StepExpose<F, K>; };
  readonly context?: readonly (keyof Ctx<F> & string)[];
  readonly output?: boolean;
  readonly progress?: boolean;
}
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
 * stack — plus `data`, the task's `mapError` value (`ErrorOf<F, K>`), when it has one.
 * @public
 */
interface ClientStepError<E> extends SerializedError {
  readonly data?: E;
}
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
  readonly child?: ChildSummary;
} : SE extends {
  readonly child: infer CE extends object;
} ? {
  readonly child?: ClientState<ChildFlowOf<F, K>, CE, Depth>;
} : {});
/**
 * The projected (client-safe) state of a wizard for exposure spec `E`. `Depth` counts the child
 * edges still allowed: 8 real child levels below the root are typed precisely, deeper ones are
 * `ClientStateFallback`. The flow `output` is present only with `expose.output: true`,
 * `progress` only with `expose.progress: true`.
 * @public
 */
type ClientState<F extends AnyFlow, E, Depth extends number = 8> = [Depth] extends [never] ? ClientStateFallback : {
  readonly instanceId: string;
  readonly epoch: number;
  readonly seq: number;
  readonly status: WizardStatus;
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
} : {});
/**
 * A `select` projection's mapper: from the typed wizard state to the projected value.
 * @public
 */
type ProjectionSelect<F extends AnyFlow, S> = (state: Snapshot<F>['state']) => S;
/**
 * A projection of flow `F` producing the client state type `S` — either deny-by-default
 * (`expose`, `S = ClientState<F, E>`) or arbitrary (`select`, `S` = its return type). The
 * `Flow` object it belongs to is compared by identity; `S` is what Mirror frames carry
 * (`ProjectionOutput<P>`).
 * @public
 */
interface Projection<F extends AnyFlow, S> {
  readonly '~types': {
    readonly flow: F;
    readonly state: S;
  } | undefined;
  /** The source flow (identity: `wizard.project()` rejects a projection of any other flow object). */
  readonly flow: F;
  /** The exposure spec (deny-by-default projections); `undefined` for a `select` projection. */
  readonly expose: ExposeSpec<F> | undefined;
  /** The mapper (`select` projections); `undefined` for an `expose` projection. */
  readonly select: ProjectionSelect<F, S> | undefined;
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
/**
 * Define a projection of a flow. `{ expose }`: deny-by-default — only the listed step inputs /
 * outputs / issues / errors, child summaries or specs, context keys, the flow output (`output:
 * true`) and `progress` (`progress: true`) cross the wire (`wizard.project(projection)` →
 * `ClientState<F, E>`). `{ select }`: an arbitrary typed mapper over the wizard state
 * (`wizard.project(projection)` → its return type). The two are mutually exclusive.
 * @public
 */
declare function defineProjection<F extends AnyFlow, const E extends ExposeSpec<F>, S = ClientState<F, E>>(flow: F, options: {
  readonly expose: E;
  readonly select?: undefined;
} | {
  readonly expose?: undefined;
  readonly select: ProjectionSelect<F, S>;
}): Projection<F, S>;
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
//#region src/mirror/wire.d.ts
/**
 * Server → client: one full projected snapshot (`state`) of instance `instanceId`, tagged with
 * `epoch` (increments on every resume) and `seq` (increments per applied event). A Mirror
 * applies a frame only when `(epoch, seq)` is newer than the last applied one.
 * @public
 */
interface Frame<S> {
  readonly kind: 'snapshot';
  readonly instanceId: string;
  readonly epoch: number;
  readonly seq: number;
  readonly state: S;
}
/**
 * Client → server: a wire `Command` (JSON, decoded with `parseCommand` on the server) addressed
 * to one instance. `commandId` correlates the `WireAck`; `expectedSeq`, when present, makes the
 * server reject the command with `STALE` unless the instance is exactly at that seq. `command`
 * is a `Command<F>` (`Command<AnyFlow>`, i.e. string ids, until it is decoded for a flow).
 * @public
 */
interface WireCommand<F extends AnyFlow = AnyFlow> {
  readonly commandId: string;
  readonly instanceId: string;
  readonly expectedSeq?: number;
  readonly command: Command<F>;
}
/**
 * Server → client: the `CommandResult` of the command `commandId`, plus the instance `seq`
 * right after processing it (state itself arrives through frames, never through acks).
 * @public
 */
interface WireAck {
  readonly commandId: string;
  readonly result: CommandResult;
  readonly seq: number;
}
/**
 * Strictly decode an untrusted value into a `WireCommand<F>` for `flow`: exact property
 * allow-list, non-empty string ids, `expectedSeq` a non-negative integer when present, and the
 * nested `command` decoded with `parseCommand(flow, …)` (issues are prefixed with
 * `['command']`). The server half (`createMirrorSource().dispatch`) runs it on every input;
 * hosts can run it themselves before authorising the command.
 * @public
 */
declare function parseWireCommand<F extends AnyFlow>(flow: F, input: unknown): BoundaryResult<WireCommand<F>>;
/**
 * Strictly check an untrusted value as a `Frame` envelope: exact property allow-list,
 * `kind: 'snapshot'`, a non-empty `instanceId`, non-negative integer `epoch` / `seq`, and a
 * `state` (any JSON value — a `select` projection may produce a primitive, an array or `null`)
 * whose own `instanceId` / `epoch` / `seq` (the projection's base facts), when it is an object
 * that carries them, match the envelope. The projected state's SHAPE is the projection's
 * business and is not checked here. `createMirror` runs it on every frame (invalid frames are
 * ignored); hosts that relay frames can run it themselves.
 * @public
 */
declare function parseFrame(input: unknown): BoundaryResult<Frame<unknown>>;
//#endregion
//#region src/mirror/transport.d.ts
/**
 * Client-side transport of the wire protocol: `subscribe` delivers frames (the server sends the
 * current frame on subscribe, then one per committed batch); `send` delivers a `WireCommand`
 * and resolves with its `WireAck`. Rejections of `send` (network failures) propagate to the
 * Mirror caller unchanged.
 * @public
 */
interface Transport<S> {
  subscribe(onFrame: (frame: Frame<S>) => void): () => void;
  send(command: WireCommand): Promise<WireAck>;
}
//#endregion
//#region src/mirror/create-mirror.d.ts
/**
 * `createMirror` options: the `transport` (typed by the projected state), an optional id
 * generator for `commandId`s, and `optimisticConcurrency` (send `expectedSeq` = the last
 * applied seq with every command, so a concurrent change answers `STALE`; default `false`).
 * @public
 */
interface MirrorOptions<P extends AnyProjection> {
  readonly transport: Transport<ProjectionOutput<P>>;
  readonly ids?: IdGenerator;
  readonly optimisticConcurrency?: boolean;
}
/**
 * The typed command sugar of a Mirror (and of a `MirrorChild`), typed by flow `F`: the same
 * methods as `Wizard`, each resolving with the ack's `CommandResult`; `dispatch` is the wire
 * door; `child(step)` scopes the same sugar to a nested flow.
 * @public
 */
interface MirrorCommands<F extends AnyFlow> {
  start(): Promise<CommandResult>;
  next(): Promise<CommandResult>;
  back(): Promise<CommandResult>;
  go(step: ViewId<F>): Promise<CommandResult>;
  setInput<K extends ViewId<F>>(step: K, patch: DraftOf<F, K>): Promise<CommandResult>;
  resetInput(step: ViewId<F>): Promise<CommandResult>;
  send<E extends EventType<F>>(event: E, payload: unknown, options?: {
    readonly correlationId?: string;
  }): Promise<CommandResult>;
  run(step: TaskId<F>): Promise<CommandResult>;
  retry(step: TaskId<F>): Promise<CommandResult>;
  cancel(reason?: string): Promise<CommandResult>;
  runReady(): Promise<CommandResult>;
  compensate(options?: {
    readonly from?: StepId<F>;
    readonly reason?: string;
  }): Promise<CommandResult>;
  reset(): Promise<CommandResult>;
  /** Skip a ready-or-active non-final step (`step.skipped { reason: 'command' }`). */
  skip(step: StepId<F>, reason?: string): Promise<CommandResult>;
  /** Return a done / failed / skipped step to `idle` (+ transitive dependents with `cascade`, default `true`). */
  invalidate(step: StepId<F>, options?: {
    readonly cascade?: boolean;
  }): Promise<CommandResult>;
  /** The wire door: any `Command` of flow `F`, sent as-is (the server re-decodes it with `parseCommand`). */
  dispatch(command: Command<F>): Promise<CommandResult>;
  /**
   * The same sugar scoped to the child flow of flow step `step`: every command travels as
   * `{ type: 'child', path: [...path, step], command }`. Nestable.
   */
  child<K extends ChildStepId<F>>(step: K): MirrorChild<ChildFlowOf<F, K>>;
}
/**
 * A scoped sender for a nested flow (`mirror.child(step)`, `.child(step).child(step2)`): the
 * `MirrorCommands` of the child flow, wrapped as `child` commands on `path`. It carries no
 * state of its own — read the child's projected state from `steps[step].child` of the mirror's
 * snapshot (exposed with `child: ExposeSpec`).
 * @public
 */
interface MirrorChild<F extends AnyFlow> extends MirrorCommands<F> {
  /** Path from the root wizard to this child (`['fulfil']`, `['fulfil', 'pack']`). */
  readonly path: readonly [string, ...string[]];
}
/**
 * Client-side replica of a wizard through projection `P`: read the projected state
 * (`getSnapshot`/`subscribe`), and send typed commands — the same sugar as `Wizard`
 * (`MirrorCommands`), each resolving with the ack's `CommandResult`; transport failures and
 * misrouted acks reject. `instanceId/epoch/seq` mirror the last applied frame (`null` before
 * the first one); `connected` is true from the first frame until `dispose`.
 * @public
 */
interface Mirror<P extends AnyProjection> extends MirrorCommands<ProjectionFlow<P>> {
  /** Latest projected state (stable identity per applied frame), `null` before the first frame. */
  getSnapshot(): ProjectionOutput<P> | null;
  /** Notified after every applied frame and on `dispose`; a no-op after `dispose`. */
  subscribe(listener: () => void): () => void;
  readonly instanceId: string | null;
  readonly epoch: number | null;
  readonly seq: number | null;
  readonly connected: boolean;
  /** Unsubscribe from the transport; later commands resolve `{ ok: false, code: 'DISPOSED' }`. */
  dispose(): void;
}
/**
 * Create a Mirror over `transport`. Subscribes immediately; the server sends the current frame
 * on subscribe, so `getSnapshot()` is non-null as soon as the transport delivers it.
 * @public
 */
declare function createMirror<P extends AnyProjection>(options: MirrorOptions<P>): Mirror<P>;
//#endregion
//#region src/mirror/source.d.ts
/**
 * Server half of a Mirror: frames out, wire commands in. `S` is the projected state type of
 * the projection it was created with (`ClientState<F, E>` for an `expose` projection, the
 * mapper's return type for a `select` one).
 * @public
 */
interface MirrorSource<S> {
  /** Sends the current frame immediately, then one frame per committed batch. */
  subscribe(onFrame: (frame: Frame<S>) => void): () => void;
  /**
   * Decode + gate a wire command and dispatch it. Never rejects for data problems: a bad
   * shape or an id unknown to the flow → `INVALID_COMMAND` (with issues), a foreign
   * `instanceId` → `INVALID_COMMAND`, an `expectedSeq` that is not the current seq → `STALE`,
   * a disposed wizard or source → `DISPOSED`; otherwise the wizard's own `CommandResult`. The
   * ack's `seq` is the instance seq after processing.
   */
  dispatch(command: WireCommand): Promise<WireAck>;
  /** Stop pushing frames, drop every subscriber and answer `DISPOSED` to later commands. Does not dispose the wizard. */
  dispose(): void;
}
/**
 * Create the server half of a Mirror for `wizard` seen through `projection` (which must be
 * defined for the wizard's flow OBJECT — `DEFINITION_INVALID` otherwise, same name or not).
 * Frames are built with `wizard.project(projection)` and cached per snapshot, so many
 * subscribers share one object.
 * @public
 */
declare function createMirrorSource<F extends AnyFlow, S>(wizard: Wizard<F>, projection: Projection<F, S>): MirrorSource<S>;
//#endregion
//#region src/replay.d.ts
/**
 * `replay` options. Either `context` (the context INPUT the wizard was created with, parsed
 * through the flow's context boundary — the fold starts from the initial state, so the events
 * must begin at `seq` 1) or `from` (a base state — `getState()` captured earlier — the fold
 * starts there and events with `seq <= from.seq` are skipped; a truncated log or a resumed
 * wizard need it). `upTo` stops the fold after that `seq` (inclusive); `instanceId` /
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
 * `persist.failed` are skipped. Pure and deterministic: for a fresh wizard whose log was not
 * truncated by `logSize`, `replay(flow, wizard.log(), { context, instanceId: wizard.id })` deep-equals
 * `wizard.getState()`.
 * @public
 */
declare function replay<F extends AnyFlow>(flow: F, events: readonly WizardEvent<F>[], options: ReplayOptions<F>): Snapshot<F>['state'];
//#endregion
export { type AnyFlow, type AnyProjection, type Boundary, type Checker, type ChildCommand, type ChildFlowOf, type ChildStepId, type ChildSummary, type ChildWizardEvent, type ClientState, type ClientStepError, type ClientStepState, type Clock, type Command, type CommandResult, type ContextInput, type Ctx, type DepsOf, type DraftOf, type Duration, type ErrorOf, type EventType, type Explanation, type ExposeSpec, type Flow, type FlowBuilder, type FlowGraph, type FlowOutput, type FlowStep, type FlowWarning, type Frame, type InputOf, type Issue$1 as Issue, type MemoryStore, type Mirror, type MirrorChild, type MirrorCommands, type MirrorOptions, type MirrorSource, type NavResult, type OutputOf, type PayloadOf, type Progress, type Projection, type ProjectionFlow, type ProjectionOutput, type ProjectionSelect, type ReplayOptions, type ResumeOptions, type RetryPolicy, type RootWizardEvent, type Scheduler, type SendResult, type SerializedError, type SetInputCommand, type Snapshot, type SnapshotMigration, type Step, type StepApi, type StepErrorOf, type StepExpose, type StepId, type StepKind, type StepState, type StepStatus, type Store, type TaskId, type Transport, type ViewId, type WaitOutput, type WireAck, type WireCommand, type Wizard, WizardError, type WizardErrorCode, type WizardEvent, type WizardOptions, type WizardStatus, boundary, createMemoryStore, createMirror, createMirrorSource, createWizard, createWizardAsync, defineFlow, defineProjection, inspect, isChildEvent, isWizardError, parseCommand, parseFrame, parseWireCommand, replay, resumeWizard, resumeWizardAsync, toMermaid };
//# sourceMappingURL=index.d.ts.map