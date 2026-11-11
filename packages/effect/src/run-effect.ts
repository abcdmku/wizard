import {
  boundary,
  createRunFailure,
  type JsonValue,
  RUN_ADAPTER,
  type RunAdapter,
  type RunArgs,
  type RunFailure,
} from '@openwizard/core'
import type { Cause, Effect, Exit, ManagedRuntime } from 'effect'

/**
 * Wizard deps that carry the Effect runtime of a run. Declare them with
 * `deps: boundary.trusted<EffectDeps<Services>>()` and pass `{ deps: { runtime } }` per run
 * (or once with `provide`), so a test swaps the Layer without redefining the wizard.
 * @public
 */
export interface EffectDeps<R, ER = never> {
  readonly runtime: ManagedRuntime.ManagedRuntime<R, ER>
}

/** The error a runtime's Layer can fail with while it is being built. @public */
export type RuntimeErrorOf<D> = D extends EffectDeps<infer _R, infer ER> ? ER : never

/** The services the runtime in deps `D` provides. */
type ServicesOf<D> = D extends EffectDeps<infer R, infer _ER> ? R : never

/** Options for `runEffect`. `Data` is the JSON value stored as the step's typed error data. @public */
export interface RunEffectOptions<E, Data extends JsonValue> {
  /**
   * Turn a typed Effect failure into the value stored as the step's `error.data` (and
   * `ErrorOf<F, step>`). Without it, a typed failure is still recorded as kind `'typed'`, with no
   * data. A throwing `mapError` records a defect.
   */
  readonly mapError?: (error: E) => Data
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
export function runEffect<
  C,
  D extends EffectDeps<never, unknown>,
  A,
  E,
  Data extends JsonValue = never,
  Args extends RunArgs<C, D> = RunArgs<C, D>,
>(
  program: (args: RunArgs<C, D> & Args) => Effect.Effect<A, E, ServicesOf<D>>,
  options: RunEffectOptions<E | RuntimeErrorOf<D>, Data> = {},
): RunAdapter<C, D, A, Data, Args> {
  const run = async (args: Args): Promise<A> => {
    // `D` is only known to extend `EffectDeps<never, unknown>`; its runtime provides `ServicesOf<D>`.
    const runtime = args.deps.runtime as ManagedRuntime.ManagedRuntime<ServicesOf<D>, unknown>
    let exit: Exit.Exit<A, unknown>
    try {
      exit = await runtime.runPromiseExit(program(args), { signal: args.signal })
    } catch (error) {
      throw createRunFailure('defect', error)
    }
    if (exit._tag === 'Success') return exit.value
    // A `Fail` reason carries the program's `E` or the runtime Layer's error.
    throw failureOf(exit.cause as Cause.Cause<E | RuntimeErrorOf<D>>, options.mapError)
  }
  return { [RUN_ADAPTER]: { run, output: boundary.trusted<A>() } }
}

/** Classify a failed Effect: a defect wins over a typed failure, which wins over interruption. */
function failureOf<E, Data extends JsonValue>(
  cause: Cause.Cause<E>,
  mapError: ((error: E) => Data) | undefined,
): RunFailure {
  const defect = cause.reasons.find((reason) => reason._tag === 'Die')
  if (defect !== undefined) return createRunFailure('defect', defect.defect)
  const typed = cause.reasons.find((reason) => reason._tag === 'Fail')
  if (typed !== undefined) {
    if (mapError === undefined) return createRunFailure('typed', typed.error)
    try {
      return createRunFailure('typed', typed.error, mapError(typed.error))
    } catch (mapped) {
      return createRunFailure('defect', mapped)
    }
  }
  if (cause.reasons.length > 0) {
    return createRunFailure('interrupted', new Error('the Effect fiber was interrupted'))
  }
  return createRunFailure('defect', new Error('the Effect failed without a cause'))
}
