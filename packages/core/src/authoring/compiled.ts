/**
 * CompiledFlow — the runtime representation of a flow definition.
 *
 * `defineWizard()` produces a typed `Wizard<…>`; compilation turns it
 * into this plain, untyped structure that the machine and interpreter consume.
 * Keeping the machine on `CompiledFlow` (not on the generic `Flow<F>`) means the
 * engine never depends on user-level generics and can be tested with literals.
 *
 * @internal
 */

import type { Issue } from '../machine/state'
import type { JsonValue } from './types/primitives'

export type StepKind = 'step' | 'view' | 'flow'

export type MaybePromise<T> = T | Promise<T>

/** Result of parsing through a boundary. */
export type BoundaryResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] }

/** Runtime boundary: `parse` may be sync or async (Standard Schema allows both). */
export interface RuntimeBoundary {
  readonly kind: 'standard' | 'parse' | 'guard' | 'assert' | 'trusted'
  parse(value: unknown): MaybePromise<BoundaryResult>
}

/** Static or dynamic transition target(s). `null` means no successor. */
export type NextRef = string | readonly string[] | null

/**
 * Retry policy. `backoff`: fixed ms, or `'exponential'` =
 * `min(baseMs * factor^(attempt-1), maxBackoffMs)` with `baseMs` 200, `factor` 2,
 * `maxBackoffMs` 30_000 by default; absent → 0 ms. `jitter` (0..1) shortens each delay by a
 * random share of up to `jitter` (the drawn due time is recorded, so replay is exact). `when`
 * decides per failure whether to retry at all: it receives the step's `mapError` value when
 * the step maps errors, else the raw thrown value; the executor evaluates it (a throw = no retry),
 * the machine only reads the verdict.
 */
export interface RetryPolicy {
  readonly retries: number
  readonly backoff?: number | 'exponential'
  readonly baseMs?: number
  readonly factor?: number
  readonly maxBackoffMs?: number
  readonly jitter?: number
  readonly when?: (error: unknown) => boolean
}

export interface NeedSpec {
  readonly kind: 'all' | 'any' | 'optional'
  readonly steps: readonly string[]
}

export interface EachSpec {
  readonly items: Hook<readonly unknown[]>
  readonly key?: (item: unknown, index: number) => string
  readonly concurrency: number
}

export type ExposeSpec = {
  readonly input: boolean
  readonly output: boolean | readonly string[]
}

/**
 * Arguments passed to every hook. Built by the interpreter from state + step.
 * `needs` contains the outputs of the producers selected by the step's joins.
 */
export interface HookArgs {
  readonly step: string
  readonly path: readonly string[]
  readonly context: unknown
  /** Injected dependencies, typed for users via `DepsOf<F>`. */
  readonly deps: unknown
  readonly input: unknown
  readonly output: unknown
  readonly needs: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
  readonly attempt: number
  readonly runId: number
  readonly idempotencyKey: string
  /**
   * Patch the flow context (recorded as `context.changed`; JSON only). A function receives the
   * latest committed context and returns the patch, applied atomically.
   */
  update(patch: Record<string, unknown> | ((current: unknown) => unknown)): void
  /** Report progress: a transient `step.progress` event for observers (never persisted). */
  progress(value: unknown): void
  /** Hook-specific extras such as from, to, payload, event, item, index or reason. */
  readonly [extra: string]: unknown
}

export type Hook<R = unknown> = (args: HookArgs) => MaybePromise<R>

/** Return contract for flow-level `on[event]` handlers: may cancel the flow. */
export type FlowOnHandlerResult = void | undefined | { readonly cancel?: string }

/**
 * A step-level event handler's result reaches the machine raw. `waitFor` accepts
 * `keep`/`done`/`fail`; a view's passive `on` accepts `next`; other passive handlers
 * return nothing. The compiler never touches it.
 */
export type OnHandlerResult = unknown

export interface CompiledStep {
  readonly id: string
  readonly kind: StepKind
  readonly label?: string
  /** Author documentation (`description` on the step config). */
  readonly description?: string
  /** Author metadata (`meta` on the step config), JSON only. */
  readonly meta?: Readonly<Record<string, JsonValue>>
  /**
   * Data joins gate the step. They also activate it, unless a function `next` declares it as a
   * target: then only that choice does.
   */
  readonly needs?: Readonly<Record<string, NeedSpec>>
  /** Snapshotted map source, item identity and maximum simultaneous items. */
  readonly each?: EachSpec
  /** Durable delay in milliseconds, evaluated once per activation. */
  readonly sleep?: number | Hook<number>
  /** Alternate failure edge. It does not change the happy-path sink role. */
  readonly fallback?: string
  /** Static successors, or a `next` hook for dynamic resolution, or none. */
  readonly next:
    | { readonly kind: 'static'; readonly targets: readonly string[] }
    | {
        readonly kind: 'dynamic'
        /**
         * Declared targets of the `next` hook (`targets` on the step config): the runtime
         * validates the chosen ids against them and routes the others to `skipped` (reason
         * `not-taken`).
         */
        readonly targets?: readonly string[]
      }
    | { readonly kind: 'none' }
  readonly input?: RuntimeBoundary
  readonly initial?: unknown
  readonly output?: RuntimeBoundary
  readonly hooks: {
    readonly canEnter?: Hook<boolean>
    readonly canExit?: Hook<boolean>
    /** Dynamic view draft initializer. Static defaults remain in `CompiledStep.initial`. */
    readonly initial?: Hook<unknown>
    readonly enter?: Hook<void>
    readonly exit?: Hook<void>
    readonly validate?: Hook<void | readonly Issue[]>
    readonly run?: Hook<unknown>
    readonly next?: Hook<NextRef>
    readonly on?: Readonly<Record<string, Hook<OnHandlerResult>>>
    readonly waitFor?: Readonly<Record<string, Hook<OnHandlerResult>>>
    readonly compensate?: Hook<void>
    /** RAW `context` mapper of a flow step; the executor parses its value through `child.context` (once). */
    readonly childContext?: Hook<unknown>
    /** RAW `deps` mapper of a flow step; the child bridge parses its value through `child.deps` (once) at creation. */
    readonly childDeps?: Hook<unknown>
    readonly childOutput?: Hook<unknown>
    /** Skip predicate evaluated when the step becomes ready (false → `step.skipped { reason: 'when' }`). */
    readonly when?: Hook<boolean>
    /** Maps a run failure to a JSON-safe value stored as `StepError.data` (`args.error` = raw error). */
    readonly mapError?: Hook<unknown>
    /** Custom idempotency key for an idempotent run (`args` = run args). */
    readonly idempotencyKey?: Hook<string>
  }
  /** An idempotent run is re-run with the same key after a crash instead of failing `interrupted`. */
  readonly idempotent?: boolean
  readonly retry?: RetryPolicy
  /** Run timeout (ms). */
  readonly timeoutMs?: number
  /** Event timeout: after `afterMs` of being active, go to `next`. */
  readonly waitTimeout?: { readonly afterMs: number; readonly next: string }
  readonly expose: ExposeSpec
  /** Child flow definition (kind === 'flow'). */
  readonly child?: CompiledFlow
}

export interface CompiledFlow {
  /** Pure final result selector; called after the interpreter drains. */
  readonly output?: (args: { readonly context: unknown }) => unknown
  /** Required: persistence identity together with `version`. */
  readonly name: string
  readonly version: number
  /** Author documentation (`description` on the definition header). */
  readonly description?: string
  /** Author metadata (`meta` on the definition header), JSON only. */
  readonly meta?: Readonly<Record<string, JsonValue>>
  /** Context always enters through a boundary (`boundary.trusted<C>()` for unvalidated defaults). */
  readonly context: RuntimeBoundary
  /** Optional dependency-injection boundary (usually `boundary.trusted<D>()`). */
  readonly deps?: RuntimeBoundary
  /** Dependencies bound by wizard.provide(); merged when creating this child. */
  readonly providedDeps?: Readonly<Record<string, unknown>>
  readonly events: Readonly<Record<string, RuntimeBoundary>>
  /** Flow-level event handlers, run after step-level ones in the same batch. */
  readonly on?: Readonly<Record<string, Hook<FlowOnHandlerResult>>>
  /** Per-event correlation extractors; a mismatch with the run's `correlationId` drops the event. */
  readonly correlate?: Readonly<Record<string, (payload: unknown) => string | undefined>>
  readonly steps: Readonly<Record<string, CompiledStep>>
  /** Declaration order of step ids. */
  readonly order: readonly string[]
  /** One or more entry steps (activated by `start()`). */
  readonly start: readonly string[]
  /** Pull activations indexed by producer id. */
  readonly feeds: Readonly<Record<string, readonly string[]>>
  /** Steps with no normal static successors and no consumers of their output. */
  readonly sinks: readonly string[]
  readonly policies: {
    readonly onFailure: 'halt' | 'compensate'
    readonly retry?: RetryPolicy
    readonly autoRun: 'ready' | 'manual'
    readonly concurrency: number
    readonly unmatchedEvents: { readonly buffer: boolean; readonly ttlMs: number }
    /**
     * Compensation phase 1 grace: how long the machine waits for aborted runs to
     * settle before treating them as orphaned (persisted timer). Also the default
     * `timeoutMs` of every `compensate` call. Default 30_000.
     */
    readonly compensationGraceMs?: number
  }
  /** Runtime-only: identity used to detect a flow embedding one of its ancestors. */
  readonly identity: object
}
