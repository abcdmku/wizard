/**
 * Per-kind constructor configs (concrete object types, so excess-property checks work) and the
 * `StepApi` of pre-bound constructors.
 * @packageDocumentation
 */

import type { Boundary } from './boundary'
import type { ContextInput, DepsOf, FlowOutput } from './extractors'
import type { AnyFlow } from './flow'
import type { OnHandlers, ViewOnResult, WaitOnResult } from './handlers'
import type {
  BaseArgs,
  CompensateArgs,
  DependsOn,
  EnterArgs,
  ExitArgs,
  MapErrorArgs,
  NextArgs,
  NextRef,
  NextSpec,
  OutputArgs,
  RunArgs,
  WaitOutput,
  WhenSpec,
} from './hook-args'
import type { Duration, Issue, MaybePromise, RetryPolicy } from './primitives'
import type { Step } from './step'

/**
 * `s.view` configuration. `I` / `O` are inferred from `input` ONLY (`NoInfer` everywhere else):
 * without `input` the view has no draft (`I = never`, `O = undefined`) and `initial` is rejected.
 * @public
 */
export interface ViewCfg<C, Ev, D, I, O, N extends string> {
  readonly label?: string
  /** Boundary for the draft input; the OUTPUT side is what hooks and `steps[k].output` see. */
  readonly input?: Boundary<O, I>
  /** Initial draft (INPUT side, partial). Requires `input`. */
  readonly initial?: NoInfer<Partial<I>>
  readonly validate?: (
    a: OutputArgs<C, D, NoInfer<O>>,
  ) => MaybePromise<void | undefined | readonly Issue[]>
  readonly canEnter?: (a: EnterArgs<C, D>) => MaybePromise<boolean>
  readonly canExit?: (a: OutputArgs<C, D, NoInfer<O>>) => MaybePromise<boolean>
  readonly enter?: (a: EnterArgs<C, D>) => unknown
  readonly exit?: (a: ExitArgs<C, D, NoInfer<O>>) => unknown
  /** External-event handlers while the view is current; `{ next }` moves the cursor. */
  readonly on?: OnHandlers<C, Ev, D, ViewOnResult<N>>
  readonly when?: WhenSpec<C, D>
  readonly next?: NextSpec<C, D, NoInfer<O>, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.task(run, options)` options. `E` (the `mapError` value type) is inferred from `mapError`.
 * @public
 */
export interface TaskOptions<C, Ev, D, O, N extends string, E = never> {
  readonly label?: string
  /** Optional re-check of the value returned by `run` (fixes the step's output type). */
  readonly output?: Boundary<O, unknown>
  readonly retry?: RetryPolicy
  readonly timeout?: Duration
  readonly compensate?: (a: CompensateArgs<C, D, O>) => unknown
  readonly enter?: (a: EnterArgs<C, D>) => unknown
  readonly exit?: (a: ExitArgs<C, D, O>) => unknown
  /** External-event handlers while the task runs (may `update()` context; return nothing). */
  readonly on?: OnHandlers<C, Ev, D, void>
  readonly when?: WhenSpec<C, D>
  /**
   * `true`: after a crash a `running` task is re-run on resume with the same idempotency key
   * (`args.idempotencyKey`, default `${instanceId}:${step}:${runId}`) instead of failing
   * `interrupted`; a function supplies the key.
   */
  readonly idempotent?: boolean | ((a: RunArgs<C, D>) => string)
  /** Map a failure (thrown value / rejection) to a JSON-safe value stored as `error.data`. */
  readonly mapError?: (error: unknown, a: MapErrorArgs<C, D>) => MaybePromise<E>
  readonly next?: NextSpec<C, D, O, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.wait` configuration. `T` is the phantom captured from `timeout` (`undefined` when absent)
 * that decides whether `WaitOutput` carries the `{ event: 'timeout' }` marker.
 * @public
 */
export interface WaitCfg<C, Ev, D, N extends string, T = unknown> {
  readonly label?: string
  /** One handler per event; `{ done }` overrides the output with a `WaitOutput` of this step. */
  readonly on: OnHandlers<C, Ev, D, WaitOnResult<N, NoInfer<WaitOutput<Ev, T>>>>
  readonly timeout?: { readonly after: Duration; readonly next: N } & T
  readonly enter?: (a: EnterArgs<C, D>) => unknown
  readonly exit?: (a: ExitArgs<C, D, WaitOutput<Ev, T>>) => unknown
  readonly when?: WhenSpec<C, D>
  readonly next?: NextSpec<C, D, WaitOutput<Ev, T>, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.decision` configuration. The step's output is the normalized list of chosen targets
 * (`readonly N[]`: `'a'` → `['a']`, `null` → `[]`).
 * @public
 */
export interface DecisionCfg<C, Ev, D, N extends string> {
  readonly label?: string
  readonly next: (a: NextArgs<C, D, undefined>) => MaybePromise<NextRef<N>>
  readonly on?: OnHandlers<C, Ev, D, void>
  readonly when?: WhenSpec<C, D>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.flow(child, cfg)` configuration.
 * @public
 */
export interface FlowCfg<C, Ev, D, CF extends AnyFlow, O, N extends string> {
  readonly label?: string
  /** Builds the child's context input (parsed ONCE by the child's context boundary at child creation). */
  readonly context: (a: BaseArgs<C, D>) => ContextInput<CF>
  /**
   * Builds the child's deps (parsed by the child's `deps` boundary when it declares one, at
   * child creation); when omitted the parent's deps object is passed through unchanged.
   */
  readonly deps?: (a: BaseArgs<C, D>) => DepsOf<CF>
  /** Optional re-check of the child's output (fixes the step's output type). */
  readonly output?: Boundary<O, unknown>
  readonly exit?: (a: ExitArgs<C, D, O>) => unknown
  readonly on?: OnHandlers<C, Ev, D, void>
  readonly when?: WhenSpec<C, D>
  readonly next?: NextSpec<C, D, O, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.final` configuration.
 * @public
 */
export interface FinalCfg<C, Ev, D, O> {
  readonly label?: string
  readonly output?: (a: BaseArgs<C, D>) => O
  readonly on?: OnHandlers<C, Ev, D, void>
}

/**
 * Constructors pre-bound to `C`/`Ev`/`D`. Only `N` captures literals; no `const` params.
 * `I = never` means "this step has no draft input"; `O` is `undefined` (never `never`) when a
 * step has no output value. A view's `I`/`O` come from its `input` boundary only; a wait's
 * `T` phantom records whether it declares a `timeout`; a decision's output is `readonly N[]`;
 * a task's `E` is its `mapError` value type (`never` without `mapError`).
 * @public
 */
export interface StepApi<C, Ev, D> {
  view<I = never, O = [I] extends [never] ? undefined : I, N extends string = never>(
    cfg: ViewCfg<C, Ev, D, I, O, N>,
  ): Step<C, Ev, D, I, O, N, 'view', never>
  task<R, O = Awaited<R>, N extends string = never, E = never>(
    run: (a: RunArgs<C, D>) => R,
    options?: TaskOptions<C, Ev, D, O, N, E>,
  ): Step<C, Ev, D, never, O, N, 'task', never, E>
  wait<N extends string = never, T = undefined>(
    cfg: WaitCfg<C, Ev, D, N, T>,
  ): Step<
    C,
    Ev,
    D,
    never,
    WaitOutput<Ev, [T] extends [undefined] ? undefined : true>,
    N,
    'wait',
    never
  >
  decision<N extends string>(
    cfg: DecisionCfg<C, Ev, D, N>,
  ): Step<C, Ev, D, never, readonly N[], N, 'decision', never>
  flow<CF extends AnyFlow, O = FlowOutput<CF>, N extends string = never>(
    child: CF,
    cfg: FlowCfg<C, Ev, D, CF, O, N>,
  ): Step<C, Ev, D, never, O, N, 'flow', CF>
  final<O = undefined>(cfg?: FinalCfg<C, Ev, D, O>): Step<C, Ev, D, never, O, never, 'final', never>
}
