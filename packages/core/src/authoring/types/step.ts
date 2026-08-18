/**
 * The step records: what a constructor returns (`Step`), the compact form stored in a flow
 * (`FlowStep`) and their phantom facts.
 * @packageDocumentation
 */

import type { Boundary } from './boundary'
import type { OnHandlers, OnResult } from './handlers'
import type {
  BaseArgs,
  CompensateArgs,
  DependsOn,
  EnterArgs,
  ExitArgs,
  MapErrorArgs,
  NextSpec,
  OutputArgs,
  RunArgs,
  WhenSpec,
} from './hook-args'
import type { Duration, Issue, MaybePromise, RetryPolicy, StepKind } from './primitives'

/**
 * Phantom facts of a step: input (draft) type, output type, referenced ids, child flow and the
 * `mapError` value type (`E`, `never` without `mapError`).
 * @public
 */
export interface StepTypes<I, O, N extends string, CF, E = never> {
  readonly input: I
  readonly output: O
  readonly refs: N
  readonly child: CF
  readonly error: E
}

/**
 * Contravariant probe that records which context / events / deps a step is bound to; the
 * assembly check `T[K] extends { '~bound': BoundTo<C, Ev, D> | undefined }` accepts steps
 * written for a subset context / events / deps and rejects unrelated ones. Phantom only.
 * @public
 */
export type BoundTo<C, Ev, D> = (args: BaseArgs<C, D>, events: Ev) => void

/**
 * One step as returned by a constructor. `C` context, `Ev` event map, `D` deps, `I` raw input
 * (draft) type, `O` output type, `N` every step id literal this step references (phantom),
 * `K` kind, `CF` child flow, `E` the `mapError` value type (tasks; `never` otherwise). Every
 * config field is present (`undefined` when unset).
 * @public
 */
export interface Step<C, Ev, D, I, O, N extends string, K extends StepKind, CF, E = never> {
  readonly kind: K
  readonly '~types': StepTypes<I, O, N, CF, E> | undefined
  readonly '~bound': BoundTo<C, Ev, D> | undefined
  readonly label: string | undefined
  readonly dependsOn: DependsOn<N> | undefined
  readonly next: NextSpec<C, D, O, N> | undefined
  /** Any kind (v0.2): external-event handlers while the step is active; return contract by kind. */
  readonly on: OnHandlers<C, Ev, D, OnResult<K, N>> | undefined
  /** Any non-final kind (v0.2): skip predicate. */
  readonly when: WhenSpec<C, D> | undefined
  // view
  readonly input: Boundary<O, I> | undefined
  readonly initial: Partial<I> | undefined
  readonly validate:
    | ((a: OutputArgs<C, D, O>) => MaybePromise<void | undefined | readonly Issue[]>)
    | undefined
  readonly canEnter: ((a: EnterArgs<C, D>) => MaybePromise<boolean>) | undefined
  readonly canExit: ((a: OutputArgs<C, D, O>) => MaybePromise<boolean>) | undefined
  readonly enter: ((a: EnterArgs<C, D>) => unknown) | undefined
  readonly exit: ((a: ExitArgs<C, D, O>) => unknown) | undefined
  // task
  readonly run: ((a: RunArgs<C, D>) => unknown) | undefined
  readonly output: Boundary<O, unknown> | ((a: BaseArgs<C, D>) => O) | undefined
  readonly retry: RetryPolicy | undefined
  readonly timeout: Duration | { readonly after: Duration; readonly next: N } | undefined
  readonly compensate: ((a: CompensateArgs<C, D, O>) => unknown) | undefined
  /** Task (v0.2): re-run after a crash instead of failing `interrupted`; a function supplies the key. */
  readonly idempotent: boolean | ((a: RunArgs<C, D>) => string) | undefined
  /** Task (v0.2): maps a failure to the JSON-safe `error.data` (`ErrorOf<F, K>`). */
  readonly mapError: ((error: unknown, a: MapErrorArgs<C, D>) => MaybePromise<E>) | undefined
  // flow
  readonly child: CF | undefined
  readonly context: ((a: BaseArgs<C, D>) => unknown) | undefined
  readonly deps: ((a: BaseArgs<C, D>) => unknown) | undefined
}

/**
 * Untyped view of any step record — the runtime's internal shape (never exported from the barrel).
 * @internal
 */
// biome-ignore lint/suspicious/noExplicitAny: internal wildcard view used only by the runtime
export type AnyStep = Step<any, any, any, any, any, string, StepKind, any, any>

/**
 * What `Flow.steps[k]` is typed as: the per-step facts only (kind + phantom). `C`/`Ev`/`D` are
 * NOT repeated per step so a flow's printed type stays O(steps); every extractor reads only
 * `kind` and `'~types'`.
 * @public
 */
export interface FlowStep<I, O, N extends string, K extends StepKind, CF, E = never> {
  readonly kind: K
  readonly '~types': StepTypes<I, O, N, CF, E> | undefined
}

/**
 * Compacts a constructor result to its `FlowStep`.
 * @public
 */
export type CompactStep<S> = S extends {
  readonly kind: infer K extends StepKind
  readonly '~types': StepTypes<infer I, infer O, infer N, infer CF, infer E> | undefined
}
  ? FlowStep<I, O, N, K, CF, E>
  : never
