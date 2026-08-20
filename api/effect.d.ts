import { Effect, Layer } from "effect";
import { AnyFlow, FlowFailure, FlowOutput, FlowRun, RunArgs, TaskAdapter } from "@openwizard/core";
import { StandardSchemaV1 } from "@standard-schema/spec";
import * as EffectModule from "effect/Effect";
import * as LayerModule from "effect/Layer";
import * as ManagedRuntimeModule from "effect/ManagedRuntime";
import { ManagedRuntime as ManagedRuntime$1 } from "effect/ManagedRuntime";
//#region src/execute.d.ts
/** Await the terminal result of an existing FlowRun in the Effect error channel. @public */
declare function awaitResult<F extends AnyFlow>(run: FlowRun<F>): Effect.Effect<FlowOutput<F>, FlowFailure<F>>;
/** Start an existing FlowRun and await its terminal result as an Effect. @public */
declare function execute<F extends AnyFlow>(run: FlowRun<F>): Effect.Effect<FlowOutput<F>, FlowFailure<F>>;
//#endregion
//#region src/runner.d.ts
/** Trace naming and attributes for one Effect task attempt. @public */
interface EffectTraceOptions<C, D> {
  readonly name?: string | ((args: RunArgs<C, D>) => string);
  readonly attributes?: Readonly<Record<string, unknown>> | ((args: RunArgs<C, D>) => Readonly<Record<string, unknown>>);
}
/** Durable boundaries and tracing for an adapted Effect task. @public */
interface EffectTaskOptions<C, D, A, E> {
  /** Required durable boundary for the task success value. */
  readonly output: StandardSchemaV1<unknown, A>;
  /** Required durable boundary for the typed Effect failure value. */
  readonly error: StandardSchemaV1<unknown, E>;
  readonly trace?: false | EffectTraceOptions<C, D>;
}
/** Defaults shared by every task created by an Effect runner. @public */
interface EffectRunnerOptions {
  readonly trace?: false | EffectTraceOptions<unknown, unknown>;
}
type MissingServices<Need, Provided> = [Need] extends [Provided] ? unknown : {
  readonly '~missing-effect-services': Exclude<Need, Provided>;
};
type EffectSuccess<P> = P extends Effect.Effect<unknown, unknown, unknown> ? EffectModule.Effect.Success<P> : never;
type EffectError<P> = P extends Effect.Effect<unknown, unknown, unknown> ? EffectModule.Effect.Error<P> : never;
type EffectContext<P> = P extends Effect.Effect<unknown, unknown, unknown> ? EffectModule.Effect.Context<P> : never;
type EffectTaskOptionsFor<C, D, P, Provided> = [P] extends [Effect.Effect<unknown, unknown, unknown>] ? EffectTaskOptions<C, D, EffectSuccess<P>, EffectError<P>> & MissingServices<EffectContext<P>, Provided> : never;
type EffectTaskAdapterFor<C, D, P> = [P] extends [Effect.Effect<unknown, unknown, unknown>] ? TaskAdapter<C, D, EffectSuccess<P>, EffectError<P>> : never;
/** Adapts Effect 3 programs to OpenWizard tasks. @public */
interface EffectRunner<Provided> {
  task<C, D, P>(body: (args: RunArgs<C, D>) => P, options: NoInfer<EffectTaskOptionsFor<C, D, P, Provided>>): EffectTaskAdapterFor<C, D, P>;
  /** Dispose a Layer-created runtime; a supplied ManagedRuntime remains caller-owned. */
  dispose(): Promise<void>;
}
type RuntimeRequirements<T extends ManagedRuntime$1<never, unknown>> = ManagedRuntimeModule.ManagedRuntime.Context<T>;
type LayerRequirements<T extends Layer.Layer<never, unknown, never>> = LayerModule.Layer.Success<T>;
type RuntimeProvided<T> = T extends ManagedRuntime$1<never, unknown> ? RuntimeRequirements<T> : never;
type LayerProvided<T> = T extends Layer.Layer<never, unknown, never> ? LayerRequirements<T> : never;
/** Create an Effect 3 task runner from a managed runtime or closed Layer. @public */
declare function makeEffectRunner<RT>(source: RT, options?: EffectRunnerOptions, ..._check: RT extends ManagedRuntime$1<never, unknown> ? [] : [never]): EffectRunner<RuntimeProvided<RT>>;
declare function makeEffectRunner<L>(source: L, options?: EffectRunnerOptions, ..._check: L extends Layer.Layer<never, unknown, never> ? [] : [never]): EffectRunner<LayerProvided<L>>;
//#endregion
export { type EffectRunner, type EffectRunnerOptions, type EffectTaskOptions, type EffectTraceOptions, awaitResult, execute, makeEffectRunner };
//# sourceMappingURL=index.d.ts.map