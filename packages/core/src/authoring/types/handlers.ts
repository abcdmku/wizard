/**
 * Return contracts of the `on[event]` handlers by kind (step-level and flow-level) and the
 * correlation extractors.
 * @packageDocumentation
 */

import type { EventArgs, FlowOnArgs } from './hook-args'
import type { MaybePromise, StepKind } from './primitives'

/**
 * What a `wait` step's `on[event]` handler may return: nothing (the event completes the step —
 * output `{ event, payload }` — through its static `next`), `{ next }` (a single id overriding
 * it; `null` / `undefined` = no override), `{ keep: true }` (consume the event, keep waiting),
 * `{ done: output, next? }` (complete with that output — `O`, the step's `WaitOutput` — instead
 * of the event) or `{ fail: reason }` (fail the step, `kind: 'hook'`).
 * @public
 */
export type WaitOnResult<N extends string, O = unknown> =
  | void
  | undefined
  | { readonly next?: N | null | undefined }
  | { readonly keep: true }
  | { readonly done: O; readonly next?: N | null | undefined }
  | { readonly fail: string }
/**
 * What a `view` step's `on[event]` handler may return: nothing, or `{ next }` — an external
 * event moves the cursor (a transition with `cause: 'event'` that runs `canEnter` / `exit` /
 * `enter` and skips input parsing / `validate` / `canExit`).
 * @public
 */
export type ViewOnResult<N extends string> =
  | void
  | undefined
  | { readonly next?: N | null | undefined }
/**
 * Return contract of a step-level `on[event]` handler by kind: `WaitOnResult` for waits,
 * `ViewOnResult` for views, `void` for tasks / decisions / flows / finals (they may `update()`
 * context, never redirect).
 * @public
 */
export type OnResult<K extends StepKind, N extends string> = [K] extends ['wait']
  ? WaitOnResult<N>
  : [K] extends ['view']
    ? ViewOnResult<N>
    : void
/**
 * Step-level `on` handlers, one per event the step listens for while ACTIVE (payload already
 * parsed by the flow's event boundary); `R` is the kind's return contract (`OnResult`).
 * @public
 */
export type OnHandlers<C, Ev, D, R> = {
  readonly [E in keyof Ev]?: (a: EventArgs<C, D, Ev[E], E>) => MaybePromise<R>
}
/**
 * What a flow-level `on[event]` handler may return: nothing, or `{ cancel: reason }` to cancel
 * the flow (subject to the compensation policy).
 * @public
 */
export type FlowOnResult = void | undefined | { readonly cancel: string }
/**
 * Flow-level `on` handlers (`defineFlow({ on })`): run after the step-level handlers of the
 * same event, in the same batch, whether or not a step handled it.
 * @public
 */
export type FlowOnHandlers<C, Ev, D> = {
  readonly [E in keyof Ev]?: (a: FlowOnArgs<C, D, Ev[E], E>) => MaybePromise<FlowOnResult>
}
/**
 * Correlation extractors (`defineFlow({ correlate })`): per event, the correlation id of a
 * parsed payload (`undefined` = this payload carries none). An event whose id differs from the
 * wizard's `correlationId` (`createWizard(flow, { correlationId })`) is dropped
 * (`event.dropped { reason: 'correlation' }`), never buffered.
 * @public
 */
export type CorrelateSpec<Ev> = {
  readonly [E in keyof Ev]?: (payload: Ev[E]) => string | undefined
}
