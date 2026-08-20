import { Effect, Layer } from "effect";
import { AnyFlow, FlowFailure, FlowOutput, FlowRun, RunArgs, TaskAdapter } from "@openwizard/core";
import { StandardSchemaV1 } from "@standard-schema/spec";
import * as LayerModule from "effect/Layer";
import * as ManagedRuntimeModule from "effect/ManagedRuntime";
import { ManagedRuntime as ManagedRuntime$1 } from "effect/ManagedRuntime";
//#region src/execute.d.ts
/** Await the terminal result of an existing FlowRun in the Effect v4 error channel. @public */
declare function awaitResult<F extends AnyFlow>(run: FlowRun<F>): Effect.Effect<FlowOutput<F>, FlowFailure<F>>;
/** Start an existing FlowRun and await its terminal result as an Effect v4 value. @public */
declare function execute<F extends AnyFlow>(run: FlowRun<F>): Effect.Effect<FlowOutput<F>, FlowFailure<F>>;
//#endregion
//#region src/runner.d.ts
/** Per-task tracing metadata. @public */
interface EffectV4TraceOptions<C, D> {
  readonly name?: string | ((args: RunArgs<C, D>) => string);
  readonly attributes?: Readonly<Record<string, unknown>> | ((args: RunArgs<C, D>) => Readonly<Record<string, unknown>>);
}
/** Required durable boundaries and optional tracing for an Effect v4 task. @public */
interface EffectV4TaskOptions<C, D, A, E> {
  /** Required durable boundary for the task success value. */
  readonly output: StandardSchemaV1<unknown, A>;
  /** Required durable boundary for the typed Effect failure value. */
  readonly error: StandardSchemaV1<unknown, E>;
  readonly trace?: false | EffectV4TraceOptions<C, D>;
}
/** Defaults applied to every v4 task created by a runner. @public */
interface EffectV4RunnerOptions {
  readonly trace?: false | EffectV4TraceOptions<unknown, unknown>;
}
type MissingServices<Need, Provided> = [Need] extends [Provided] ? unknown : {
  readonly '~missing-effect-v4-services': Exclude<Need, Provided>;
};
type EffectSuccess<P> = P extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;
type EffectError<P> = P extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type EffectServices<P> = P extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type EffectTaskOptionsFor<C, D, P, Provided> = [P] extends [Effect.Effect<unknown, unknown, unknown>] ? EffectV4TaskOptions<C, D, EffectSuccess<P>, EffectError<P>> & MissingServices<EffectServices<P>, Provided> : never;
type EffectTaskAdapterFor<C, D, P> = [P] extends [Effect.Effect<unknown, unknown, unknown>] ? TaskAdapter<C, D, EffectSuccess<P>, EffectError<P>> : never;
/** A v4 runner whose task methods preserve the Effect success/error/service channels. @public */
interface EffectV4Runner<Provided> {
  task<C, D, P>(body: (args: RunArgs<C, D>) => P, options: NoInfer<EffectTaskOptionsFor<C, D, P, Provided>>): EffectTaskAdapterFor<C, D, P>;
  /** Dispose a Layer-created runtime; a supplied ManagedRuntime remains caller-owned. */
  dispose(): Promise<void>;
}
type RuntimeRequirements<T extends ManagedRuntime$1<never, unknown>> = ManagedRuntimeModule.ManagedRuntime.Services<T>;
type LayerRequirements<T extends Layer.Layer<never, unknown, never>> = LayerModule.Success<T>;
type RuntimeProvided<T> = T extends ManagedRuntime$1<never, unknown> ? RuntimeRequirements<T> : never;
type LayerProvided<T> = T extends Layer.Layer<never, unknown, never> ? LayerRequirements<T> : never;
/** Create an Effect 4 task runner from a managed runtime or closed Layer. @public */
declare function makeEffectV4Runner<RT>(source: RT, options?: EffectV4RunnerOptions, ..._check: RT extends ManagedRuntime$1<never, unknown> ? [] : [never]): EffectV4Runner<RuntimeProvided<RT>>;
declare function makeEffectV4Runner<L>(source: L, options?: EffectV4RunnerOptions, ..._check: L extends Layer.Layer<never, unknown, never> ? [] : [never]): EffectV4Runner<LayerProvided<L>>;
//#endregion
export { type EffectV4Runner, type EffectV4RunnerOptions, type EffectV4TaskOptions, type EffectV4TraceOptions, awaitResult, execute, makeEffectV4Runner };
//# sourceMappingURL=index.d.ts.map