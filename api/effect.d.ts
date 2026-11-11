import { JsonValue, RunAdapter, RunArgs } from "@openwizard/core";
import { Effect, ManagedRuntime } from "effect";
//#region src/run-effect.d.ts
/**
 * Wizard deps that carry the Effect runtime of a run. Declare them with
 * `deps: boundary.trusted<EffectDeps<Services>>()` and pass `{ deps: { runtime } }` per run
 * (or once with `provide`), so a test swaps the Layer without redefining the wizard.
 * @public
 */
interface EffectDeps<R, ER = never> {
  readonly runtime: ManagedRuntime.ManagedRuntime<R, ER>;
}
/** The error a runtime's Layer can fail with while it is being built. @public */
type RuntimeErrorOf<D> = D extends EffectDeps<infer _R, infer ER> ? ER : never;
/** The services the runtime in deps `D` provides. */
type ServicesOf<D> = D extends EffectDeps<infer R, infer _ER> ? R : never;
/** Options for `runEffect`. `Data` is the JSON value stored as the step's typed error data. @public */
interface RunEffectOptions<E, Data extends JsonValue> {
  /**
   * Turn a typed Effect failure into the value stored as the step's `error.data` (and
   * `ErrorOf<F, step>`). Without it, a typed failure is still recorded as kind `'typed'`, with no
   * data. A throwing `mapError` records a defect.
   */
  readonly mapError?: (error: E) => Data;
}
/**
 * Run an Effect program as a step. The program gets the step's `RunArgs` and runs on
 * `args.deps.runtime`, so its services must be provided by that runtime (checked at compile
 * time). The step's abort signal (timeout, cancel, dispose) interrupts the fiber. A typed
 * failure is recorded as failure kind `'typed'` (with `mapError`'s value as data), a defect as
 * `'defect'`, an interruption as `'interrupted'`.
 * With `each` or `needs`, return this adapter from the step's `run` callback. That callback
 * infers its item and joined data before creating the Effect program:
 * `run: args => runEffect(() => Payments.use(p => p.charge(args.item)))`.
 * A returned adapter uses its output boundary at execution. Declare a static step `output`
 * boundary when a snapshot must restore non-JSON outputs.
 *
 * ```ts
 * charge: step({
 *   run: runEffect(({ context }) => Payments.use((p) => p.charge(context.orderId)), {
 *     mapError: (error) => ({ reason: error.reason }),
 *   }),
 * })
 * ```
 * @public
 */
declare function runEffect<C, D extends EffectDeps<never, unknown>, A, E, Data extends JsonValue = never, Args extends RunArgs<C, D> = RunArgs<C, D>>(program: (args: RunArgs<C, D> & Args) => Effect.Effect<A, E, ServicesOf<D>>, options?: RunEffectOptions<E | RuntimeErrorOf<D>, Data>): RunAdapter<C, D, A, Data, Args>;
//#endregion
export { type EffectDeps, type RunEffectOptions, type RuntimeErrorOf, runEffect };
//# sourceMappingURL=index.d.ts.map