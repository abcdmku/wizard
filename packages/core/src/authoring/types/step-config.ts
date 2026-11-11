/** The runnable/wait/sleep/routing, view and child-flow configs. */

import type { RunAdapter } from '../run-adapter'
import type { Boundary } from './boundary'
import type { DepsOf, RequiredDepsOf } from './extractors'
import type { OnHandlers, WaitHandlersFor } from './handlers'
import type {
  CompensateArgs,
  EachRunArgs,
  EnterArgs,
  ExitArgs,
  HookArgs,
  HookArgsFor,
  OutputArgs,
  RunArgs,
} from './hook-args'
import type { Duration, Issue, IsUnset, JsonValue, MaybePromise, RetryPolicy } from './primitives'
import type { StepLike } from './step'
import type {
  EachOf,
  NeedRef,
  NeedsOutput,
  RetryError,
  ReturnedAdapterError,
  StepOutput,
} from './step-inference'
import type { AnyFlow } from './wizard'

type CheckedNeed = NeedRef & {
  readonly any?: readonly StepLike[]
  readonly optional?: StepLike
}

export interface Common<C, D, Nd, Dp> {
  readonly label?: string
  readonly description?: string
  readonly meta?: Readonly<Record<string, JsonValue>>
  /** Typed data join: activates once every need is done; hooks get `needs` typed. */
  readonly needs?: Nd & { readonly [A in keyof Nd]: CheckedNeed }
  /** Control gate only (does not activate). */
  readonly dependsOn?: readonly Dp[] | { readonly any: readonly Dp[] }
  readonly when?: (args: HookArgs<C, D, NeedsOutput<Nd>>) => MaybePromise<boolean>
  readonly enter?: (args: EnterArgs<C, D, NeedsOutput<Nd>>) => unknown
}
type NextResult<R> = MaybePromise<R | readonly R[] | null>
type NextHandler<C, D, O, N, R> = (args: OutputArgs<C, D, O, N>) => NextResult<R>
type Next<C, D, O, N, Nx, Nr> = Nx | readonly Nx[] | null | NextHandler<C, D, O, N, Nr>

export interface Routing<C, D, O, Nd, Nx, Nr, Tg> {
  /** Push edge: an id/step, several, `null`, or a function of the output (requires `targets`). */
  readonly next?: Next<C, D, O, NeedsOutput<Nd>, Nx, Nr>
  /** Every id a function `next` may return; untaken targets are skipped (`not-taken`). */
  readonly targets?: readonly Tg[]
}
export interface StepConfig<
  C,
  Ev,
  D,
  R,
  OB,
  Em,
  Ea,
  Item,
  Nd,
  Nx,
  Nr,
  Tg,
  Fb,
  Dp,
  To,
  H,
  Xk,
  Wk extends PropertyKey = never,
> extends Common<C, D, Nd, Dp>,
    Routing<C, D, NoInfer<StepOutput<R, OB, Item, H, Ev, Xk>>, Nd, Nx, Nr, Tg> {
  readonly exit?: (
    args: ExitArgs<C, D, NoInfer<StepOutput<R, OB, Item, H, Ev, Xk>>, NeedsOutput<Nd>>,
  ) => unknown
  readonly on?: OnHandlers<C, Ev, D, NeedsOutput<Nd>>
  readonly run?:
    | ((
        args: 'each' extends Xk
          ? EachRunArgs<C, D, NeedsOutput<Nd>, Item>
          : RunArgs<C, D, NeedsOutput<Nd>>,
      ) => R | NoInfer<RunAdapter<C, D, unknown, Ea & JsonValue>>)
    | RunAdapter<
        C,
        D,
        R,
        Ea & JsonValue,
        'each' extends Xk
          ? EachRunArgs<C, D, NeedsOutput<Nd>, Item>
          : RunArgs<C, D, NeedsOutput<Nd>>
      >
  /** Map over items: `run` gets `item` / `index`, the output is an array in input order. */
  readonly each?: (args: HookArgs<C, D, NeedsOutput<Nd>>) => readonly Item[]
  readonly key?: (item: NoInfer<Item>, index: number) => string
  readonly concurrency?: number
  readonly output?: Boundary<OB, unknown>
  readonly retry?: RetryPolicy<NoInfer<RetryError<Em, Ea | ReturnedAdapterError<R>>>>
  readonly timeout?: Duration | { readonly after: Duration; readonly next: To }
  readonly compensate?: (
    args: CompensateArgs<C, D, NoInfer<StepOutput<R, OB, Item, H, Ev, Xk>>, NeedsOutput<Nd>>,
  ) => unknown
  readonly idempotent?: boolean | ((args: RunArgs<C, D, NeedsOutput<Nd>>) => string)
  readonly mapError?: (error: unknown, args: RunArgs<C, D, NeedsOutput<Nd>>) => MaybePromise<Em>
  /** When the step fails for good it is skipped (`fallback`) and the run continues here. */
  readonly fallback?: Fb
  readonly waitFor?: H &
    WaitHandlersFor<C, Ev, D, NeedsOutput<Nd>, H, Wk> &
    OptionKeys<Wk, PropertyKey>
  /** Durable timer: completes when due (survives restarts). */
  readonly sleep?: Duration | ((args: HookArgs<C, D, NeedsOutput<Nd>>) => Duration)
}
export interface ViewConfig<C, Ev, D, I, O, Nd, Nx, Nr, Tg, Dp, Nh = never>
  extends Common<C, D, Nd, Dp>,
    Routing<C, D, NoInfer<O>, Nd, Nx, Nr, Tg> {
  /** Draft boundary: hooks see the OUTPUT side, `setInput` / `initial` the INPUT side. */
  readonly input?: Boundary<O, I>
  readonly initial?:
    | NoInfer<Partial<I>>
    | ((args: { readonly context: C; readonly deps: D }) => MaybePromise<NoInfer<Partial<I>>>)
  readonly validate?: (
    args: OutputArgs<C, D, NoInfer<O>, NeedsOutput<Nd>>,
  ) => MaybePromise<void | undefined | readonly Issue[]>
  readonly canEnter?: (args: EnterArgs<C, D, NeedsOutput<Nd>>) => MaybePromise<boolean>
  readonly canExit?: (args: OutputArgs<C, D, NoInfer<O>, NeedsOutput<Nd>>) => MaybePromise<boolean>
  readonly exit?: (args: ExitArgs<C, D, NoInfer<O>, NeedsOutput<Nd>>) => unknown
  /** A handler may navigate: its `next` ids are checked like any other ref. */
  readonly on?: OnHandlers<C, Ev, D, NeedsOutput<Nd>, { readonly next?: Nh | null }>
}
export type ChildOutput<CO, OB, Item> = EachOf<Item, IsUnset<OB> extends true ? CO : OB>
/** `flow(child, config)`: `CIn` / `CO` / `CD` are the child's context input, output and deps. */
export interface ChildConfig<C, Ev, D, CIn, CO, CD, OB, Item, Nd, Nx, Nr, Tg, Fb, Dp>
  extends Common<C, D, Nd, Dp>,
    Routing<C, D, NoInfer<ChildOutput<CO, OB, Item>>, Nd, Nx, Nr, Tg> {
  /** Builds the child's context input (per item with `each`). */
  readonly context: (args: HookArgsFor<C, D, NeedsOutput<Nd>, Item>) => CIn
  readonly each?: (args: HookArgs<C, D, NeedsOutput<Nd>>) => readonly Item[]
  readonly key?: (item: NoInfer<Item>, index: number) => string
  readonly concurrency?: number
  readonly output?: Boundary<OB, unknown>
  readonly fallback?: Fb
  readonly exit?: (
    args: ExitArgs<C, D, NoInfer<ChildOutput<CO, OB, Item>>, NeedsOutput<Nd>>,
  ) => unknown
  readonly on?: OnHandlers<C, Ev, D, NeedsOutput<Nd>>
  /** Child deps, merged over what the child had `provide()`d. */
  readonly deps?: (args: HookArgsFor<C, D, NeedsOutput<Nd>, Item>) => CD
}
/** What a child `deps` mapper returns: the child's remaining deps, optionally overriding provided ones. */
export type ChildDeps<CF extends AnyFlow> = [NonNullable<CF['~types']>['provided']] extends [never]
  ? DepsOf<CF>
  : RequiredDepsOf<CF> & {
      [K in keyof DepsOf<CF> as K extends NonNullable<CF['~types']>['provided']
        ? K
        : never]?: DepsOf<CF>[K]
    }
/** Added when this wizard's deps do not cover `RequiredDepsOf<child>`: the `deps` mapper is required. */
export interface ChildDepsRequired<C, D, Nd, CD, Item> {
  readonly deps: (args: HookArgsFor<C, D, NeedsOutput<Nd>, Item>) => CD
}
export type DepsRule<C, D, Nd, Item, CF extends AnyFlow> =
  {} extends RequiredDepsOf<CF>
    ? unknown
    : [D] extends [RequiredDepsOf<CF>]
      ? unknown
      : ChildDepsRequired<C, D, Nd, ChildDeps<CF>, Item>

/** Records which options a config literal was written with (`Xk`); unknown keys stay excess errors. */
export type OptionKeys<Xk, Known extends PropertyKey> = {
  readonly [P in Xk & Known]?: unknown
} & {
  readonly [P in Xk &
    Known &
    (
      | 'run'
      | 'waitFor'
      | 'sleep'
      | 'input'
      | 'each'
      | 'output'
      | 'needs'
      | 'next'
      | 'targets'
    )]: unknown
}
export type StepOption = keyof StepConfig<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>
export type ViewOption = keyof ViewConfig<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>
export type ChildOption = keyof ChildConfig<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>
