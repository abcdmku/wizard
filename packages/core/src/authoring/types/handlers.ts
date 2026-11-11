/** Closed event-handler return contracts. */

import type { StepError } from './assembly'
import type { EventArgs } from './hook-args'
import type { MaybePromise } from './primitives'

/**
 * A wait verdict: complete with payload or done, keep waiting, or fail.
 * A `waitFor` handler returns nothing (the payload becomes the output), `{ done }`,
 * `{ keep: true }` or `{ fail }`.
 * @public
 */
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
/** Passive handlers for declared external events. @public */
export type OnHandlers<C, Ev, D, N, R = void> = {
  readonly [E in keyof Ev]?: (args: EventArgs<C, D, Ev[E], E, N>) => MaybePromise<R | undefined>
}
