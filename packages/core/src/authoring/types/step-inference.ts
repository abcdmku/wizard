/** Inference facts used by constructor signatures and assembly validation. */
import type { RUN_ADAPTER, RunAdapter } from '../run-adapter'
import type { EachRunArgs, RunArgs } from './hook-args'
import type { IsUnset } from './primitives'
import type { AnyStep, Ref, StaticNext } from './step'

type OutputOfStep<S> = S extends { readonly '~types': infer P }
  ? NonNullable<P> extends { readonly output: infer O }
    ? O
    : never
  : never
/**
 * One data requirement: a step, the first of several, or an optional step.
 * Written as `needs: { alias: step | { any: [steps] } | { optional: step } }`. `any` takes the
 * first of several steps to finish, and `optional` allows the step to be skipped.
 * @public
 */
export type NeedRef =
  | AnyStep
  | { readonly any: readonly AnyStep[] }
  | { readonly optional: AnyStep }
/** Named data requirements referencing earlier step objects. @public */
export type NeedsSpec = { readonly [alias: string]: NeedRef }
export type NeedOutput<S> = S extends string
  ? // biome-ignore lint/suspicious/noExplicitAny: malformed id need already diagnosed; avoid cascades
    any
  : S extends { readonly any: readonly (infer R)[] }
    ? OutputOfStep<R>
    : S extends { readonly optional: infer R }
      ? OutputOfStep<R> | undefined
      : OutputOfStep<S>
/**
 * The parsed outputs exposed by the aliases in needs.
 * This is the typed `args.needs` of a step.
 * @public
 */
export type NeedsOutput<Nd> = { readonly [A in keyof Nd]: NeedOutput<Nd[A]> }
export type NeedStep<S> = S extends { readonly any: readonly (infer R)[] }
  ? R
  : S extends { readonly optional: infer R }
    ? R
    : S
export type NeedSteps<Nd> = { [A in keyof Nd]: NeedStep<Nd[A]> }[keyof Nd]

/** Only the facts a step has, so hovers and errors print `{ output; runnable }` rather than `error: never`. */
export type RunFacts<O, E, Rn extends boolean> = Rn extends false
  ? { readonly output: O }
  : [E] extends [never]
    ? { readonly output: O; readonly runnable: true }
    : { readonly output: O; readonly error: E; readonly runnable: true }
export type EachOf<Item, O> = IsUnset<Item> extends true ? O : O[]
type DoneOf<R, P> = R extends { readonly done: infer X }
  ? X
  : R extends { readonly keep: true } | { readonly fail: string }
    ? never
    : P
type WaitOutput<H, Ev> = {
  [E in keyof H]: E extends keyof Ev
    ? H[E] extends (...args: never[]) => infer R
      ? DoneOf<Awaited<R>, Ev[E]>
      : never
    : never
}[keyof H]
/**
 * `Xk` = the keys written in the config literal. TypeScript re-infers a failing call without its
 * context-sensitive callbacks, so a `run` / `waitFor` it could not type leaves `R` / `H` unset
 * while `Xk` still lists it: the output is then `any`, so the one error does not cascade into
 * every step that `needs` this one.
 */
type StepEach<Xk, O> = 'each' extends Xk ? O[] : O
export type StepOutput<R, OB, _Item, H, Ev, Xk> =
  IsUnset<OB> extends false
    ? StepEach<Xk, OB>
    : 'run' extends Xk
      ? StepEach<Xk, RunOutput<R>>
      : [keyof H] extends [never]
        ? 'waitFor' extends Xk
          ? // biome-ignore lint/suspicious/noExplicitAny: failure-mode only (see above)
            any
          : undefined
        : WaitOutput<H, Ev>
export type ErrorFor<Em, Ea> = IsUnset<Em> extends true ? Ea : Em
export type RetryError<Em, Ea> = [ErrorFor<Em, Ea>] extends [never] ? unknown : ErrorFor<Em, Ea>

type AdapterErrorChannel<V> = V extends { readonly [RUN_ADAPTER]: unknown }
  ? V extends RunAdapter<infer _C, infer _D, infer _A, infer E, infer _Args>
    ? E
    : never
  : never
type AdapterOutput<V> = V extends { readonly [RUN_ADAPTER]: unknown }
  ? V extends RunAdapter<infer _C, infer _D, infer A, infer _E, infer _Args>
    ? A
    : V
  : V
/** Failed callback inference must not create a spurious typed adapter error channel. */
export type ReturnedAdapterError<R> = 0 extends 1 & Awaited<R>
  ? never
  : AdapterErrorChannel<Awaited<R>>
type RunOutput<R> = AdapterOutput<Awaited<R>>
type BoundAdapterProblem<V, C, D, Nd, Item, Xk> = V extends { readonly [RUN_ADAPTER]: unknown }
  ? V extends RunAdapter<infer _C, infer _D, infer _A, infer _E, infer Accepted>
    ? [
        'each' extends Xk
          ? EachRunArgs<C, D, NeedsOutput<Nd>, Item>
          : RunArgs<C, D, NeedsOutput<Nd>>,
      ] extends [Accepted]
      ? never
      : 'returned adapter requires different context, deps, needs, or each item'
    : 'returned adapter must match RunAdapter with JSON error data'
  : never
export type ReturnedAdapterProblem<R, C, D, Nd, Item, Xk> = 0 extends 1 & Awaited<R>
  ? never
  : BoundAdapterProblem<Awaited<R>, C, D, Nd, Item, Xk>

type NextProblem<Nr, Tg> = [Nr] extends [never]
  ? never
  : [Tg] extends [never]
    ? 'a function `next` must declare `targets` (the ids or steps it may return)'
    : never
export type RoutingProblem<Xk, Nx, Nr, Tg> = 'next' extends Xk
  ? [StaticNext<Nx>] extends [never]
    ? [Tg] extends [never]
      ? 'a function `next` must declare `targets` (the ids or steps it may return)'
      : NextProblem<Nr, Tg>
    : 'targets' extends Xk
      ? '`targets` requires a function `next`'
      : never
  : 'targets' extends Xk
    ? '`targets` requires a function `next`'
    : never
export type IdRefs<X> = Extract<X, string>
export type ObjRefs<X> = Extract<X, AnyStep>
export type HasSuccessor<Nx, Tg> = [Extract<StaticNext<Nx>, Ref> | Tg] extends [never]
  ? false
  : true
type Behaviors<Xk> = Extract<Xk, 'run' | 'waitFor' | 'sleep'>
type RunOnly<Xk> = Extract<
  Xk,
  'retry' | 'compensate' | 'mapError' | 'idempotencyKey' | 'output' | 'fallback' | 'each'
>
type IsUnion<U, A = U> = U extends unknown ? ([A] extends [U] ? false : true) : never
/** Option combinations a step config cannot have (read from the keys it was written with). */
export type StepProblems<Xk, To> =
  | (true extends IsUnion<Behaviors<Xk>>
      ? 'a step has one behavior: `run`, `waitFor` or `sleep`'
      : never)
  | ('run' extends Xk
      ? never
      : [RunOnly<Xk>] extends [never]
        ? never
        : `\`${RunOnly<Xk> & string}\` only applies to a step with \`run\``)
  | ('each' extends Xk
      ? never
      : [Extract<Xk, 'key' | 'concurrency'>] extends [never]
        ? never
        : '`key` / `concurrency` need `each`')
  | ([To] extends [never]
      ? never
      : 'waitFor' extends Xk
        ? never
        : '`timeout: { after, next }` is only valid on a waitFor step')
