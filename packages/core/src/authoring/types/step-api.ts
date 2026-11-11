/** Pre-bound authoring constructors and checked assembly. */
import type { CheckSteps, CompactStep, RoleOf } from './assembly'
import type { ContextInput, FlowOutput } from './extractors'
import type { EmptyWait, WaitResult } from './handlers'
import type { JsonValue, MaybePromise, Unset } from './primitives'
import type { BoundTo, Links, Ref, RefWithin, Returned, Route, StaticNext, Step } from './step'
import type {
  ChildConfig,
  ChildDeps,
  ChildOption,
  ChildOutput,
  DepsRule,
  OptionKeys,
  StepConfig,
  StepOption,
  ViewConfig,
  ViewOption,
} from './step-config'
import type {
  ErrorFor,
  HasSuccessor,
  IdRefs,
  ObjRefs,
  ReturnedAdapterError,
  ReturnedAdapterProblem,
  RoutingProblem,
  RunFacts,
  StepOutput,
  StepProblems,
} from './step-inference'
import type { AnyFlow } from './wizard'

export interface Steps<M> {
  readonly '~steps': M | undefined
}
/** Constructors pre-bound to a wizard's context `C`, events `Ev` and deps `D`. */
/** Constructors bound to one context, event map and dependency type. @public */
export interface StepApi<C, Ev, D> {
  step<
    // biome-ignore lint/suspicious/noExplicitAny: failure-path default only
    R = any,
    OB = Unset,
    Em extends JsonValue | Unset = Unset,
    Ea extends JsonValue = never,
    // biome-ignore lint/suspicious/noExplicitAny: failure-path default only (no `each` to never read)
    Item = any,
    Nd = {},
    Nx extends Ref | null = never,
    Tg extends Ref = never,
    Nr extends RefWithin<Tg> = never,
    Fb extends Ref = never,
    To extends Ref = never,
    H extends { readonly [E in Wk]?: (...args: never[]) => MaybePromise<WaitResult> } = {},
    Wk extends string = never,
    Xk extends string = never,
  >(
    config: StepConfig<C, Ev, D, R, OB, Em, Ea, Item, Nd, Nx, Nr, Tg, Fb, To, H, Xk, Wk> &
      OptionKeys<Xk, StepOption>,
  ): Step<
    'step',
    RunFacts<
      StepOutput<R, OB, Item, H, Ev, Xk>,
      ErrorFor<Em, Ea | ReturnedAdapterError<R>>,
      'run' extends Xk ? true : false
    > &
      ('each' extends Xk ? { readonly each: true } : {}),
    Links<
      IdRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb | To>,
      ObjRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb | To>,
      Nd,
      Tg | Fb | To,
      HasSuccessor<Nx, Tg>,
      | StepProblems<Xk, To>
      | ReturnedAdapterProblem<R, C, D, Nd, Item, Xk>
      | RoutingProblem<Xk, Nx, Nr, Tg>
      | EmptyWait<Xk, Wk>,
      'when' extends Xk ? true : false,
      Route<Returned<Nr, Tg>, Tg>
    >,
    BoundTo<C, Ev, D>
  >
  view<
    I = never,
    O = [I] extends [never] ? undefined : I,
    Nd = {},
    Nx extends Ref | null = never,
    Tg extends Ref = never,
    Nr extends RefWithin<Tg> = never,
    Nh extends Ref = never,
    Xk extends string = never,
  >(
    config: ViewConfig<C, Ev, D, I, O, Nd, Nx, Nr, Tg, Nh> & OptionKeys<Xk, ViewOption>,
  ): Step<
    'view',
    { readonly input: I; readonly output: O },
    Links<
      IdRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Nh>,
      ObjRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Nh>,
      Nd,
      Tg | Nh,
      HasSuccessor<Nx, Tg>,
      RoutingProblem<Xk, Nx, Nr, Tg>,
      'when' extends Xk ? true : false,
      Route<Returned<Nr, Tg>, Tg>
    >,
    BoundTo<C, Ev, D>
  >
  flow<
    CF extends AnyFlow,
    OB = Unset,
    Item = Unset,
    Nd = {},
    Nx extends Ref | null = never,
    Tg extends Ref = never,
    Nr extends RefWithin<Tg> = never,
    Fb extends Ref = never,
    Xk extends string = never,
  >(
    child: CF,
    config: ChildConfig<
      C,
      Ev,
      D,
      ContextInput<CF>,
      FlowOutput<CF>,
      ChildDeps<CF>,
      OB,
      Item,
      Nd,
      Nx,
      Nr,
      Tg,
      Fb
    > &
      DepsRule<C, D, Nd, Item, CF> &
      OptionKeys<Xk, ChildOption>,
  ): Step<
    'flow',
    {
      readonly output: ChildOutput<FlowOutput<CF>, OB, Item>
      readonly child: CF
    } & ('each' extends Xk ? { readonly each: true } : {}),
    Links<
      IdRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb>,
      ObjRefs<StaticNext<Nx> | Returned<Nr, Tg> | Tg | Fb>,
      Nd,
      Tg | Fb,
      HasSuccessor<Nx, Tg>,
      RoutingProblem<Xk, Nx, Nr, Tg>,
      'when' extends Xk ? true : false,
      Route<Returned<Nr, Tg>, Tg>
    >,
    BoundTo<C, Ev, D>
  >
  /**
   * Assemble the wizard. Every reference, need, target and binding is checked here; a bad step
   * gets a diagnostic on its own property. `start` defaults to the first step.
   */
  steps<T>(
    map: CheckSteps<T, C, Ev, D>,
    options?: {
      readonly start?:
        | NoInfer<Extract<keyof T, string>>
        | readonly [NoInfer<Extract<keyof T, string>>, ...NoInfer<Extract<keyof T, string>>[]]
    },
  ): Steps<{ readonly [K in keyof T]: CompactStep<T[K], RoleOf<T, K>> }>
}
