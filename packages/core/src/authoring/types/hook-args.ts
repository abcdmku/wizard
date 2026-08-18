/**
 * Step ids / references and the argument objects every hook receives, plus the `next` / `when`
 * specifications and a wait step's output type.
 * @packageDocumentation
 */

import type {
  AbortSignalLike,
  Issue,
  MaybePromise,
  SerializedError,
  StepKind,
  StepStatus,
} from './primitives'

/**
 * String keys of a steps map.
 * @public
 */
export type Ids<T> = Extract<keyof T, string>

/**
 * A `next` target: one id, several ids (fan-out) or `null` (no successor).
 * @public
 */
export type NextRef<N extends string> = N | readonly N[] | null

/**
 * Data-readiness dependencies: every listed step must be done (`readonly N[]`) or any of them (`{ any }`).
 * @public
 */
export type DependsOn<N extends string> = readonly N[] | { readonly any: readonly N[] }

/**
 * Sibling step state as seen from inside a hook. LIMITATION (ADR-001 L1): a constructor
 * runs before its siblings exist, so this map cannot be typed per flow — it is an open map
 * of unknown input/output. Cross-step data should travel through `context` (typed) instead.
 * @public
 */
export interface SiblingState<I = unknown, O = unknown> {
  readonly kind: StepKind
  readonly status: StepStatus
  readonly attempt: number
  readonly input?: I
  readonly output?: O
  readonly issues?: readonly Issue[]
  readonly error?: SerializedError
}

/**
 * The open sibling map handed to hooks (`args.steps`).
 * @public
 */
export type SiblingStates = { readonly [id: string]: SiblingState }

/**
 * Arguments every hook receives.
 * @public
 */
export interface BaseArgs<C, D> {
  readonly context: C
  /** Patch the flow context (recorded as `context.changed`). */
  readonly update: (patch: Partial<C>) => void
  readonly deps: D
  readonly steps: SiblingStates
  readonly step: string
  /** Wizard path (`[]` for the root, `['fulfil']` inside a child flow). */
  readonly path: readonly string[]
  readonly signal: AbortSignalLike
}
/**
 * `run` hook arguments (`attempt` is 1-based). `idempotencyKey` identifies the run for the
 * out-of-domain service: `${instanceId}:${step}:${runId}` by default, or the value of the
 * task's `idempotent` key function; the same key is passed again when an idempotent task is
 * re-run after a crash.
 * @public
 */
export interface RunArgs<C, D> extends BaseArgs<C, D> {
  readonly attempt: number
  readonly idempotencyKey: string
}
/**
 * `enter` / `canEnter` hook arguments.
 * @public
 */
export interface EnterArgs<C, D> extends BaseArgs<C, D> {
  readonly from: string | null
}
/**
 * Hook arguments carrying the step's output (`validate`, `canExit`, `next`).
 * @public
 */
export interface OutputArgs<C, D, O> extends BaseArgs<C, D> {
  readonly output: O
}
/**
 * `exit` hook arguments.
 * @public
 */
export interface ExitArgs<C, D, O> extends OutputArgs<C, D, O> {
  readonly to: string | null
  readonly direction: 'forward' | 'back'
}
/**
 * `compensate` hook arguments.
 * @public
 */
export interface CompensateArgs<C, D, O> extends OutputArgs<C, D, O> {
  readonly reason: string | undefined
}
/**
 * Step-level `on[event]` handler arguments (any kind since v0.2).
 * @public
 */
export interface EventArgs<C, D, P, E> extends BaseArgs<C, D> {
  readonly event: E
  readonly payload: P
}
/**
 * Flow-level `on[event]` handler arguments (`defineFlow({ on })`): everything a step hook gets
 * except `step` (a flow-level handler belongs to no step), plus the event name and its parsed
 * payload.
 * @public
 */
export interface FlowOnArgs<C, D, P, E = string> extends Omit<BaseArgs<C, D>, 'step'> {
  readonly event: E
  readonly payload: P
}
/**
 * `next` hook arguments (the step's output is available).
 * @public
 */
export type NextArgs<C, D, O> = OutputArgs<C, D, O>
/**
 * `mapError` hook arguments: the failed run's arguments (`attempt` = the attempt that failed).
 * @public
 */
export type MapErrorArgs<C, D> = RunArgs<C, D>

/**
 * A `next` specification: a static target (id / ids / null) or a function of the step's output.
 * @public
 */
export type NextSpec<C, D, O, N extends string> =
  | NextRef<N>
  | ((a: NextArgs<C, D, O>) => MaybePromise<NextRef<N>>)

/**
 * `when` predicate of a non-final step: evaluated once the step is ready (after `dependsOn`
 * gating, before `enter`); `false` skips it (`step.skipped { reason: 'when' }` — it counts as
 * done for `dependsOn`, its `next` targets are arrived, the cursor never lands on it).
 * @public
 */
export type WhenSpec<C, D> = (a: BaseArgs<C, D>) => MaybePromise<boolean>

/**
 * Output of a wait step: the resolving `{ event, payload }` (union over every flow event),
 * plus `{ event: 'timeout' }` when the step declares a `timeout` (`T` is the phantom captured
 * from `WaitCfg.timeout`: `undefined` when the step declares none; the default `unknown` keeps
 * the marker, i.e. "any wait step").
 * @public
 */
export type WaitOutput<Ev, T = unknown> =
  | { [E in keyof Ev]: { readonly event: E; readonly payload: Ev[E] } }[keyof Ev]
  | ([T] extends [undefined] ? never : { readonly event: 'timeout' })
