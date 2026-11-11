/** Closed event-handler return contracts. */

import type { StepError } from './assembly'
import type { EventArgs, FlowOnArgs } from './hook-args'
import type { MaybePromise } from './primitives'

/** What a `waitFor` handler returns: nothing (output = payload), `{ done }`, keep waiting, or fail. */
/** A wait verdict: complete with payload or done, keep waiting, or fail. @public */
export type WaitResult =
  | void
  | undefined
  | { readonly done: unknown; readonly next?: never }
  | { readonly keep: true; readonly next?: never }
  | { readonly fail: string; readonly next?: never }
/** Wait handlers with parsed event payloads and a closed return contract. @public */
export type WaitHandlers<C, Ev, D, N> = {
  readonly [E in keyof Ev]?: (args: EventArgs<C, D, Ev[E], E, N>) => MaybePromise<WaitResult>
}
/** Contextual handler checks and return-value inference use separate maps. */
export type WaitHandlersFor<C, Ev, D, N, H, Wk extends PropertyKey> = {
  readonly [E in keyof H | Wk]: E extends keyof Ev
    ? (
        args: EventArgs<C, D, Ev[E], E, N>,
      ) => E extends keyof H
        ? H[E] extends (...args: never[]) => infer R
          ? R & MaybePromise<WaitResult>
          : MaybePromise<WaitResult>
        : MaybePromise<WaitResult>
    : StepError<`'${E & string}' is not an event of this wizard`>
}
/** `Wk` = the handler keys written (survives a failed call, unlike `H`). */
export type EmptyWait<Xk, Wk> = 'waitFor' extends Xk
  ? [Wk] extends [never]
    ? '`waitFor` needs at least one event handler'
    : never
  : never
export type UnknownEvents<H, Ev> = {
  readonly [E in Exclude<
    keyof H,
    keyof Ev
  >]: StepError<`'${E & string}' is not an event of this wizard`>
}
/** Passive handlers for declared external events. @public */
export type OnHandlers<C, Ev, D, N, R = void> = {
  readonly [E in keyof Ev]?: (args: EventArgs<C, D, Ev[E], E, N>) => MaybePromise<R | undefined>
}

// Steps and their phantom facts

/** A flow handler result that may cancel the run. @public */
export type FlowOnResult = void | undefined | { readonly cancel: string }
/** Flow-level handlers for declared external events. @public */
export type FlowOnHandlers<C, Ev, D> = {
  readonly [E in keyof Ev]?: (args: FlowOnArgs<C, D, Ev[E], E>) => MaybePromise<FlowOnResult>
}
/** Correlation extractors for declared event payloads. @public */
export type CorrelateSpec<Ev> = {
  readonly [E in keyof Ev]?: (payload: Ev[E]) => string | undefined
}
