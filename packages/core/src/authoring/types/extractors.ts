/** One extractor for each public type fact. */

import type { StepKind } from './primitives'
import type { StepFacts } from './step'
import type { AnyFlow, RemainingDeps } from './wizard'

export type TypesOf<F extends AnyFlow> = NonNullable<F['~types']>
/** The parsed context seen by hooks. @public */
export type Ctx<F extends AnyFlow> = TypesOf<F>['ctx']
/** The input accepted by the context boundary at run creation. @public */
export type ContextInput<F extends AnyFlow> = TypesOf<F>['ctxIn']
/** All dependencies seen by hooks, including supplied dependencies. @public */
export type DepsOf<F extends AnyFlow> = TypesOf<F>['deps']
/**
 * The dependencies still required when creating or resuming a run.
 * That is `DepsOf` minus what `provide()` bound.
 * @public
 */
export type RequiredDepsOf<F extends AnyFlow> = RemainingDeps<
  TypesOf<F>['deps'],
  TypesOf<F>['provided']
>
type EventMapOf<F extends AnyFlow> = unknown extends TypesOf<F>['events']
  ? Record<string, unknown>
  : TypesOf<F>['events']
type EventInputMapOf<F extends AnyFlow> = unknown extends TypesOf<F>['eventsIn']
  ? Record<string, unknown>
  : TypesOf<F>['eventsIn']
/** The event boundary input accepted by send. @public */
export type PayloadInput<F extends AnyFlow, E extends EventType<F>> = EventInputMapOf<F>[E &
  keyof EventInputMapOf<F>]
/** The declared external event names. @public */
export type EventType<F extends AnyFlow> = Extract<keyof EventMapOf<F>, string>
/** The parsed event payload seen by handlers. @public */
export type PayloadOf<F extends AnyFlow, E extends EventType<F>> = EventMapOf<F>[E]
type StepsOf<F extends AnyFlow> = TypesOf<F>['steps']
/** The literal ids of an assembled wizard. @public */
export type StepId<F extends AnyFlow> =
  unknown extends StepsOf<F> ? string : Extract<keyof StepsOf<F>, string>
type FactsOf<F extends AnyFlow, K> =
  unknown extends StepsOf<F>
    ? StepFacts
    : K extends keyof StepsOf<F>
      ? NonNullable<StepsOf<F>[K]['~types' & keyof StepsOf<F>[K]]>
      : never
export type Fact<F extends AnyFlow, K, P extends keyof StepFacts> =
  FactsOf<F, K> extends infer X ? (P extends keyof X ? X[P] : never) : never
/** The kind of a step in an assembled wizard. @public */
export type KindOf<F extends AnyFlow, K> =
  unknown extends StepsOf<F>
    ? StepKind
    : K extends keyof StepsOf<F>
      ? StepsOf<F>[K] extends { readonly kind: infer Kd }
        ? Kd
        : never
      : never
/** The inferred output of one step. @public */
export type OutputOf<F extends AnyFlow, K extends StepId<F>> = Fact<F, K, 'output'>
/** The raw input of a view, or never for steps without input. @public */
export type InputOf<F extends AnyFlow, K extends StepId<F>> = Fact<F, K, 'input'>
/** A partial patch of a view boundary input. @public */
export type DraftOf<F extends AnyFlow, K extends StepId<F>> = Partial<InputOf<F, K>>
/** The JSON error data produced by mapError or a run adapter. @public */
export type ErrorOf<F extends AnyFlow, K extends StepId<F>> = Fact<F, K, 'error'>
/** Whether a step maps over items. @public */
export type IsEach<F extends AnyFlow, K extends StepId<F>> = [Fact<F, K, 'each'>] extends [never]
  ? false
  : NonNullable<Fact<F, K, 'each'>>
/** The child flow of a flow step, or never for other step kinds. @public */
export type ChildFlowOf<F extends AnyFlow, K extends StepId<F>> =
  unknown extends StepsOf<F> ? AnyFlow : Extract<Fact<F, K, 'child'>, AnyFlow>
/** The ids of view steps. @public */
export type ViewId<F extends AnyFlow> = {
  [K in StepId<F>]: [KindOf<F, K>] extends ['view']
    ? K
    : [StepKind] extends [KindOf<F, K>]
      ? K
      : never
}[StepId<F>]
/** The ids of runnable steps. @public */
export type RunStepId<F extends AnyFlow> = {
  [K in StepId<F>]: [Fact<F, K, 'runnable'>] extends [never]
    ? never
    : [Fact<F, K, 'runnable'>] extends [false]
      ? never
      : K
}[StepId<F>]
/** The ids of runnable steps and mapped child flows that can retry failed items. @public */
export type RetryStepId<F extends AnyFlow> = {
  [K in StepId<F>]: K extends RunStepId<F> ? K : [IsEach<F, K>] extends [true] ? K : never
}[StepId<F>]
/** The ids of child-flow steps. @public */
export type ChildStepId<F extends AnyFlow> = {
  [K in StepId<F>]: [KindOf<F, K>] extends ['flow']
    ? K
    : [StepKind] extends [KindOf<F, K>]
      ? K
      : never
}[StepId<F>]
/** The stored selector result or resolved union of sink outputs. @public */
export type FlowOutput<F extends AnyFlow> = TypesOf<F>['output']
