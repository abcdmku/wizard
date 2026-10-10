/**
 * Extractors — one per concept, every one an indexed access on `'~types'` (no distributive
 * conditionals): context, deps, events, step ids and per-step facts of a flow.
 * @packageDocumentation
 */

import type { AnyFlow } from './flow'
import type { StepKind } from './primitives'

/**
 * Parsed context type of a flow (boundary OUTPUT side).
 * @public
 */
export type Ctx<F extends AnyFlow> = NonNullable<F['~types']>['ctx']
/**
 * Context input type of a flow (boundary INPUT side — what `createWizard` accepts).
 * @public
 */
export type ContextInput<F extends AnyFlow> = NonNullable<F['~types']>['ctxIn']
/**
 * Deps type of a flow (`unknown` when the flow declares no `deps` boundary).
 * @public
 */
export type DepsOf<F extends AnyFlow> = NonNullable<F['~types']>['deps']
/**
 * Event map of a flow (`{ [event]: payload }`).
 * @public
 */
export type EventMapOf<F extends AnyFlow> = NonNullable<F['~types']>['events']
/**
 * Declared event names of a flow.
 * @public
 */
export type EventType<F extends AnyFlow> = Extract<keyof EventMapOf<F>, string>
/**
 * Parsed payload type of one event.
 * @public
 */
export type PayloadOf<F extends AnyFlow, E extends EventType<F>> = EventMapOf<F>[E]
/**
 * Step ids of a flow.
 * @public
 */
export type StepId<F extends AnyFlow> = Extract<keyof F['steps'], string>
/**
 * Phantom facts of one step.
 * @public
 */
export type StepTypesOf<F extends AnyFlow, K extends StepId<F>> = NonNullable<
  F['steps'][K]['~types']
>
/**
 * Raw input (draft, INPUT side of the view's `input` boundary) type of a step; `never` without a draft.
 * @public
 */
export type InputOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['input']
/**
 * Draft patch type of a view (`Partial` of the INPUT side) — what `setInput` accepts.
 * @public
 */
export type DraftOf<F extends AnyFlow, K extends StepId<F>> = Partial<InputOf<F, K>>
/**
 * Output type of a step: parsed input (view), run result (task), `{ event, payload }` (wait),
 * child output (flow), `output()` result (final); `undefined` when the step has none.
 * @public
 */
export type OutputOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['output']
/**
 * Child flow of a `flow` step (`never` for other kinds).
 * @public
 */
export type ChildFlowOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['child']
/**
 * Mapped error type of a task (`s.task(run, { mapError })` → the value stored as
 * `steps[k].error.data`); `never` for steps without `mapError`.
 * @public
 */
export type ErrorOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['error']
/**
 * Kind of a step.
 * @public
 */
export type KindOf<F extends AnyFlow, K extends StepId<F>> = F['steps'][K]['kind']
/**
 * `true` when step `K` is exactly of kind `Kind` — or when its kind is the fully widened
 * `StepKind` (a wildcard flow such as `AnyFlow`, where every id is a `string` anyway). A step
 * whose kind is a partial union (`'view' | 'task'`) is NOT of either kind (safe direction).
 * @public
 */
export type HasKind<F extends AnyFlow, K extends StepId<F>, Kind extends StepKind> = [
  KindOf<F, K>,
] extends [Kind]
  ? true
  : [StepKind] extends [KindOf<F, K>]
    ? true
    : false
/**
 * Ids of the view steps (`go`, `setInput`, `resetInput`, `validate` accept these).
 * @public
 */
export type ViewId<F extends AnyFlow> = {
  [K in StepId<F>]: HasKind<F, K, 'view'> extends true ? K : never
}[StepId<F>]
/**
 * Ids of the task steps (`retry`, `run` accept these).
 * @public
 */
export type TaskId<F extends AnyFlow> = {
  [K in StepId<F>]: HasKind<F, K, 'task'> extends true ? K : never
}[StepId<F>]
/**
 * Ids of the `flow` steps (`child()` accepts these).
 * @public
 */
export type ChildStepId<F extends AnyFlow> = {
  [K in StepId<F>]: [ChildFlowOf<F, K>] extends [never] ? never : K
}[StepId<F>]
/**
 * Output type of a flow: the union of its `final` steps' outputs.
 * @public
 */
export type FlowOutput<F extends AnyFlow> = {
  [K in StepId<F>]: HasKind<F, K, 'final'> extends true ? OutputOf<F, K> : never
}[StepId<F>]
