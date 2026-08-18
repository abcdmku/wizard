/**
 * The wire command typed by a flow: `Command<F>` and its correlated members (`SetInputCommand`,
 * `ChildCommand`, `AnyChildCommand`).
 * @packageDocumentation
 */

import type {
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  DraftOf,
  EventType,
  StepId,
  TaskId,
  ViewId,
} from '../../authoring/types'

/** Depth budget for typed child commands: `Prev[D]` = one child level deeper; `Prev[0]` = `never` = beyond. */
type CommandDepthPrev = [never, 0, 1, 2, 3, 4, 5, 6, 7]

/**
 * A `child` command with `string` ids: what typed child commands widen to for a wildcard flow
 * (`AnyFlow`) or beyond the depth budget.
 * @public
 */
export interface AnyChildCommand {
  readonly type: 'child'
  readonly path: readonly [string, ...string[]]
  readonly command: Command<AnyFlow>
}

/**
 * `setInput` correlated per view: `step: K` with `patch: DraftOf<F, K>`.
 * @public
 */
export type SetInputCommand<F extends AnyFlow> = {
  [K in ViewId<F>]: { readonly type: 'setInput'; readonly step: K; readonly patch: DraftOf<F, K> }
}[ViewId<F>]

/**
 * A command addressed to a nested flow: `path: [flowStep]` with a `Command` of that child, or a
 * longer path (`[flowStep, grandChildStep, …]`) whose `command` is typed for the flow at its end
 * — the flattened form of nesting `child` commands. For a wildcard flow or beyond the depth
 * budget (8 child levels) it is `AnyChildCommand` (ids widen to `string`).
 * @public
 */
export type ChildCommand<F extends AnyFlow, Depth extends number = 8> = [Depth] extends [never]
  ? AnyChildCommand
  : string extends ChildStepId<F>
    ? AnyChildCommand
    : {
        [K in ChildStepId<F>]:
          | {
              readonly type: 'child'
              readonly path: readonly [K]
              readonly command: Command<ChildFlowOf<F, K>, CommandDepthPrev[Depth]>
            }
          | (ChildCommand<ChildFlowOf<F, K>, CommandDepthPrev[Depth]> extends infer Inner
              ? Inner extends {
                  readonly path: infer P extends readonly string[]
                  readonly command: infer C
                }
                ? {
                    readonly type: 'child'
                    readonly path: readonly [K, ...P]
                    readonly command: C
                  }
                : never
              : never)
      }[ChildStepId<F>]

/**
 * A wire command (JSON), typed by the flow: `go` / `setInput` / `resetInput` take a `ViewId<F>`
 * (`setInput.patch` is that view's `DraftOf`), `run` / `retry` a `TaskId<F>`, `send` an
 * `EventType<F>` (its `payload` stays `unknown` — it is re-parsed by the event boundary),
 * `compensate.from` / `skip.step` / `invalidate.step` a `StepId<F>`, and `child` a typed
 * `ChildCommand<F>`. `Depth` bounds the child recursion (8 child levels; beyond it ids widen to
 * `string`). Untrusted input becomes a `Command<F>` through `parseCommand(flow, input)`;
 * `Command<AnyFlow>` is the untyped shape.
 * @public
 */
export type Command<F extends AnyFlow = AnyFlow, Depth extends number = 8> =
  | { readonly type: 'start' }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'go'; readonly step: ViewId<F>; readonly reason?: string }
  | SetInputCommand<F>
  | { readonly type: 'resetInput'; readonly step: ViewId<F> }
  | {
      readonly type: 'send'
      readonly event: EventType<F>
      readonly payload: unknown
      readonly correlationId?: string
    }
  | { readonly type: 'run'; readonly step: TaskId<F> }
  | { readonly type: 'runReady' }
  | { readonly type: 'retry'; readonly step: TaskId<F> }
  | { readonly type: 'cancel'; readonly reason?: string }
  | { readonly type: 'compensate'; readonly from?: StepId<F>; readonly reason?: string }
  | { readonly type: 'reset' }
  | { readonly type: 'skip'; readonly step: StepId<F>; readonly reason?: string }
  | { readonly type: 'invalidate'; readonly step: StepId<F>; readonly cascade?: boolean }
  | ChildCommand<F, Depth>
