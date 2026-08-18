/**
 * CompiledFlow — the runtime representation of a flow definition.
 *
 * `defineFlow()` produces a typed `Flow<…>` for users; `compile(flow)` turns it
 * into this plain, untyped structure that the machine and interpreter consume.
 * Keeping the machine on `CompiledFlow` (not on the generic `Flow<F>`) means the
 * engine never depends on user-level generics and can be tested with literals.
 *
 * @internal
 */

import type { Issue } from '../machine/state'

export type StepKind = 'view' | 'task' | 'wait' | 'decision' | 'flow' | 'final'

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

/** Static or dynamic `next` target(s). `null` = no successor (only valid on final-ish steps). */
export type NextRef = string | readonly string[] | null

/**
 * Retry policy — data only (the machine must stay pure, so no callback form).
 * `backoff`: fixed ms, or `'exponential'` = `min(baseMs * factor^(attempt-1), maxBackoffMs)`
 * with `baseMs` 200, `factor` 2, `maxBackoffMs` 30_000 by default; absent → 0 ms.
 */
export interface RetryPolicy {
  readonly attempts: number
  readonly backoff?: number | 'exponential'
  readonly baseMs?: number
  readonly factor?: number
  readonly maxBackoffMs?: number
}

export type DepsSpec = { readonly all: readonly string[] } | { readonly any: readonly string[] }

export type ExposeSpec = {
  readonly input: boolean
  readonly output: boolean | readonly string[]
}

/**
 * Arguments passed to every hook. Built by the interpreter from state + step.
 * `steps` is a read-only typed view of sibling records for the user; here it is untyped.
 */
export interface HookArgs {
  readonly step: string
  readonly path: readonly string[]
  readonly context: unknown
  /** Injected dependencies (`createWizard(flow, { deps })`), typed for users via `DepsOf<F>`. */
  readonly deps: unknown
  readonly input: unknown
  readonly output: unknown
  readonly steps: Readonly<Record<string, import('../machine/state').StepRecord>>
  readonly signal: AbortSignal
  readonly attempt: number
  readonly runId: number
  readonly idempotencyKey: string
  /** Patch the flow context (recorded as `context.changed`). Must be JSON-serializable. */
  update(patch: Record<string, unknown>): void
  /** Hook-specific extras (`from`, `to`, `payload`, `event`, `direction`, `reason`, `child`). */
  readonly [extra: string]: unknown
}

export type Hook<R = unknown> = (args: HookArgs) => MaybePromise<R>

/** Return contract for flow-level `on[event]` handlers (v0.2): may cancel the flow. */
export type FlowOnHandlerResult = void | undefined | { readonly cancel?: string }

/**
 * A step-level `on[event]` handler's result reaches the machine RAW (`machine/wait.ts`
 * normalises it per kind: `keep`/`done`/`fail`/`next` for waits, `next` for views, `void`
 * elsewhere — anything else is `event.handlerResultIgnored`). The compiler never touches it.
 */
export type OnHandlerResult = unknown

export interface CompiledStep {
  readonly id: string
  readonly kind: StepKind
  readonly label?: string
  /** Static successors, or a `next` hook for dynamic resolution, or none. */
  readonly next:
    | { readonly kind: 'static'; readonly targets: readonly string[] }
    | { readonly kind: 'dynamic' }
    | { readonly kind: 'none' }
  readonly dependsOn?: DepsSpec
  readonly input?: RuntimeBoundary
  readonly initial?: unknown
  readonly output?: RuntimeBoundary
  readonly hooks: {
    readonly canEnter?: Hook<boolean>
    readonly canExit?: Hook<boolean>
    readonly enter?: Hook<void>
    readonly exit?: Hook<void>
    readonly validate?: Hook<void | readonly Issue[]>
    readonly run?: Hook<unknown>
    readonly next?: Hook<NextRef>
    readonly on?: Readonly<Record<string, Hook<OnHandlerResult>>>
    readonly compensate?: Hook<void>
    /** RAW `context` mapper of a flow step; the executor parses its value through `child.context` (once). */
    readonly childContext?: Hook<unknown>
    /** RAW `deps` mapper of a flow step; the child bridge parses its value through `child.deps` (once) at creation. */
    readonly childDeps?: Hook<unknown>
    readonly childOutput?: Hook<unknown>
    readonly finalOutput?: Hook<unknown>
    /** v0.2: skip predicate evaluated when the step becomes ready (false → `step.skipped { reason: 'when' }`). */
    readonly when?: Hook<boolean>
    /** v0.2: maps a task failure to a JSON-safe value stored as `StepError.data` (`args.error` = raw error). */
    readonly mapError?: Hook<unknown>
    /** v0.2: custom idempotency key for an idempotent task (`args` = run args). */
    readonly idempotencyKey?: Hook<string>
  }
  /** v0.2: an idempotent task is re-run (same key) after a crash instead of failing `interrupted`. */
  readonly idempotent?: boolean
  readonly retry?: RetryPolicy
  /** Task timeout (ms). */
  readonly timeoutMs?: number
  /** Wait timeout: after `afterMs` of being active, go to `next`. */
  readonly waitTimeout?: { readonly afterMs: number; readonly next: string }
  readonly expose: ExposeSpec
  /** Child flow definition (kind === 'flow'). */
  readonly child?: CompiledFlow
}

export interface CompiledFlow {
  /** Required: persistence identity together with `version`. */
  readonly name: string
  readonly version: number
  /** Context always enters through a boundary (`boundary.trusted<C>()` for unvalidated defaults). */
  readonly context: RuntimeBoundary
  /** Optional dependency-injection boundary (usually `boundary.trusted<D>()`). */
  readonly deps?: RuntimeBoundary
  readonly events: Readonly<Record<string, RuntimeBoundary>>
  /** v0.2: flow-level event handlers, run after step-level ones in the same batch. */
  readonly on?: Readonly<Record<string, Hook<FlowOnHandlerResult>>>
  /** v0.2: per-event correlation extractors; a mismatch with the wizard's `correlationId` drops the event. */
  readonly correlate?: Readonly<Record<string, (payload: unknown) => string | undefined>>
  readonly steps: Readonly<Record<string, CompiledStep>>
  /** Declaration order of step ids. */
  readonly order: readonly string[]
  /** One or more entry steps (activated by `start()`). */
  readonly start: readonly string[]
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
