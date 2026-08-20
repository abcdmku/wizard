import type { RunArgs } from '@openwizard/core'
import {
  createTaskFailure,
  TASK_ADAPTER,
  type TaskAdapter,
  type TaskFailureKind,
} from '@openwizard/core'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime, Option, type Tracer } from 'effect'
import type * as EffectModule from 'effect/Effect'
import type * as LayerModule from 'effect/Layer'
import type * as ManagedRuntimeModule from 'effect/ManagedRuntime'
import type { ManagedRuntime as ManagedRuntimeType } from 'effect/ManagedRuntime'

/** Trace naming and attributes for one Effect task attempt. @public */
export interface EffectTraceOptions<C, D> {
  readonly name?: string | ((args: RunArgs<C, D>) => string)
  readonly attributes?:
    | Readonly<Record<string, unknown>>
    | ((args: RunArgs<C, D>) => Readonly<Record<string, unknown>>)
}

/** Durable boundaries and tracing for an adapted Effect task. @public */
export interface EffectTaskOptions<C, D, A, E> {
  /** Required durable boundary for the task success value. */
  readonly output: StandardSchemaV1<unknown, A>
  /** Required durable boundary for the typed Effect failure value. */
  readonly error: StandardSchemaV1<unknown, E>
  readonly trace?: false | EffectTraceOptions<C, D>
}

/** Defaults shared by every task created by an Effect runner. @public */
export interface EffectRunnerOptions {
  readonly trace?: false | EffectTraceOptions<unknown, unknown>
}

type MissingServices<Need, Provided> = [Need] extends [Provided]
  ? unknown
  : {
      readonly '~missing-effect-services': Exclude<Need, Provided>
    }

type EffectSuccess<P> =
  P extends Effect.Effect<unknown, unknown, unknown> ? EffectModule.Effect.Success<P> : never
type EffectError<P> =
  P extends Effect.Effect<unknown, unknown, unknown> ? EffectModule.Effect.Error<P> : never
type EffectContext<P> =
  P extends Effect.Effect<unknown, unknown, unknown> ? EffectModule.Effect.Context<P> : never
type EffectTaskOptionsFor<C, D, P, Provided> = [P] extends [
  Effect.Effect<unknown, unknown, unknown>,
]
  ? EffectTaskOptions<C, D, EffectSuccess<P>, EffectError<P>> &
      MissingServices<EffectContext<P>, Provided>
  : never
type EffectTaskAdapterFor<C, D, P> = [P] extends [Effect.Effect<unknown, unknown, unknown>]
  ? TaskAdapter<C, D, EffectSuccess<P>, EffectError<P>>
  : never

/** Adapts Effect 3 programs to OpenWizard tasks. @public */
export interface EffectRunner<Provided> {
  task<C, D, P>(
    body: (args: RunArgs<C, D>) => P,
    options: NoInfer<EffectTaskOptionsFor<C, D, P, Provided>>,
  ): EffectTaskAdapterFor<C, D, P>
  /** Dispose a Layer-created runtime; a supplied ManagedRuntime remains caller-owned. */
  dispose(): Promise<void>
}

type RuntimeRequirements<T extends ManagedRuntimeType<never, unknown>> =
  ManagedRuntimeModule.ManagedRuntime.Context<T>
type LayerRequirements<T extends Layer.Layer<never, unknown, never>> = LayerModule.Layer.Success<T>
type RuntimeProvided<T> =
  T extends ManagedRuntimeType<never, unknown> ? RuntimeRequirements<T> : never
type LayerProvided<T> = T extends Layer.Layer<never, unknown, never> ? LayerRequirements<T> : never

interface RuntimeSource {
  readonly runFork: ManagedRuntimeType<unknown, unknown>['runFork']
  readonly dispose: ManagedRuntimeType<unknown, unknown>['dispose']
}

interface SignalWithEvents {
  readonly aborted: boolean
  addEventListener?: (
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean },
  ) => void
  removeEventListener?: (type: 'abort', listener: () => void) => void
}

interface ClassifiedFailure {
  readonly kind: TaskFailureKind
  readonly error: unknown
}

function isManagedRuntime(value: unknown): value is RuntimeSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runFork' in value &&
    typeof value.runFork === 'function' &&
    'dispose' in value &&
    typeof value.dispose === 'function'
  )
}

function classifyCause(cause: Cause.Cause<unknown>): ClassifiedFailure {
  if (Cause.isFailure(cause) && !Cause.isDie(cause) && !Cause.isInterrupted(cause)) {
    const failure = Cause.failureOption(cause)
    if (Option.isSome(failure)) return { kind: 'typed', error: failure.value }
  }
  if (Cause.isInterruptedOnly(cause)) {
    return {
      kind: 'interrupted',
      error: new Error('Effect fiber interrupted'),
    }
  }
  const defect = Cause.dieOption(cause)
  return {
    kind: 'defect',
    error: Option.isSome(defect) ? defect.value : new Error('Effect fiber failed'),
  }
}

function schemaIssues(result: StandardSchemaV1.FailureResult): string {
  return result.issues.map((issue) => issue.message).join('; ')
}

async function validateError<E>(schema: StandardSchemaV1<unknown, E>, value: unknown): Promise<E> {
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined) {
    const failure = result as StandardSchemaV1.FailureResult
    throw Object.assign(
      new Error(`Effect error schema rejected its failure: ${schemaIssues(failure)}`),
      { code: 'EFFECT_ERROR_SCHEMA_REJECTED' },
    )
  }
  return result.value
}

function traceOptions<C, D>(
  trace: false | EffectTraceOptions<C, D> | undefined,
  args: RunArgs<C, D>,
): { readonly name: string; readonly attributes?: Record<string, unknown> } | false {
  if (trace === false) return false
  const name = typeof trace?.name === 'function' ? trace.name(args) : trace?.name
  const attributes =
    typeof trace?.attributes === 'function' ? trace.attributes(args) : trace?.attributes
  return {
    name: name ?? 'openwizard.task',
    ...(attributes !== undefined ? { attributes: { ...attributes } } : {}),
  }
}

function executeEffect<C, D, A, E, Need>(
  runtime: ManagedRuntimeType<Need, unknown>,
  body: (args: RunArgs<C, D>) => Effect.Effect<A, E, Need>,
  args: RunArgs<C, D>,
  errorSchema: StandardSchemaV1<unknown, E>,
  trace: false | EffectTraceOptions<C, D> | undefined,
  defaultTrace: false | EffectTraceOptions<unknown, unknown> | undefined,
): Promise<A> {
  let program: Effect.Effect<A, E, Need>
  try {
    program = body(args)
    const effectiveTrace =
      trace === undefined ? (defaultTrace as false | EffectTraceOptions<C, D> | undefined) : trace
    const span = traceOptions(effectiveTrace, args)
    if (span !== false) {
      const spanConfig: Tracer.SpanOptions | undefined =
        span.attributes === undefined ? undefined : { attributes: span.attributes }
      program = Effect.withSpan(program, span.name, spanConfig) as Effect.Effect<A, E, Need>
    }
  } catch (error) {
    return Promise.reject(createTaskFailure('defect', error))
  }

  return new Promise<A>((resolve, reject) => {
    let fiber: ReturnType<typeof runtime.runFork>
    try {
      fiber = runtime.runFork(program)
    } catch (error) {
      reject(createTaskFailure('defect', error))
      return
    }

    let settled = false
    const signal = args.signal as unknown as SignalWithEvents
    const removeAbort = (): void => {
      signal.removeEventListener?.('abort', interrupt)
    }
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      removeAbort()
      callback()
    }
    const interrupt = (): void => {
      if (settled) return
      try {
        // Running the interruption effect through the same ManagedRuntime keeps
        // all Effect execution inside the supplied runtime. The resulting
        // interrupter fiber is intentionally detached; the observed task fiber
        // is the only one that commits a FlowRun result.
        runtime.runFork(Fiber.interrupt(fiber))
      } catch {
        // The task fiber's observer still reports the runtime's terminal cause.
      }
    }
    const observe = (exit: Exit.Exit<unknown, unknown>): void => {
      if (Exit.isSuccess(exit)) {
        settle(() => resolve(exit.value as A))
        return
      }
      const failure = classifyCause(exit.cause as Cause.Cause<unknown>)
      if (failure.kind === 'typed') {
        void validateError(errorSchema, failure.error).then(
          (data) => settle(() => reject(createTaskFailure('typed', failure.error, data))),
          (error) => settle(() => reject(createTaskFailure('defect', error))),
        )
      } else {
        settle(() => reject(createTaskFailure(failure.kind, failure.error)))
      }
    }

    fiber.addObserver(observe)
    if (signal.aborted) interrupt()
    else signal.addEventListener?.('abort', interrupt, { once: true })
  })
}

/** Create an Effect 3 task runner from a managed runtime or closed Layer. @public */
export function makeEffectRunner<RT>(
  source: RT,
  options?: EffectRunnerOptions,
  ..._check: RT extends ManagedRuntimeType<never, unknown> ? [] : [never]
): EffectRunner<RuntimeProvided<RT>>
export function makeEffectRunner<L>(
  source: L,
  options?: EffectRunnerOptions,
  ..._check: L extends Layer.Layer<never, unknown, never> ? [] : [never]
): EffectRunner<LayerProvided<L>>
export function makeEffectRunner(
  source: ManagedRuntimeType<unknown, unknown> | Layer.Layer<unknown, unknown, never>,
  options: EffectRunnerOptions = {},
  ..._check: readonly unknown[]
): EffectRunner<unknown> {
  const ownsRuntime = !isManagedRuntime(source)
  const runtime = (
    ownsRuntime
      ? ManagedRuntime.make(Layer.orDie(source as Layer.Layer<unknown, unknown, never>))
      : source
  ) as ManagedRuntimeType<unknown, unknown>
  let disposed = false

  return {
    task<C, D, P>(
      body: (args: RunArgs<C, D>) => P,
      taskOptions: NoInfer<EffectTaskOptionsFor<C, D, P, unknown>>,
    ): EffectTaskAdapterFor<C, D, P> {
      type A = EffectSuccess<P>
      type E = EffectError<P>
      type R = EffectContext<P>
      const adapter = ((args: RunArgs<C, D>) =>
        executeEffect(
          runtime as ManagedRuntimeType<R, unknown>,
          body as (args: RunArgs<C, D>) => Effect.Effect<A, E, R>,
          args,
          taskOptions.error as StandardSchemaV1<unknown, E>,
          taskOptions.trace,
          options.trace as false | EffectTraceOptions<unknown, unknown> | undefined,
        )) as TaskAdapter<C, D, A, E>
      Object.defineProperty(adapter, TASK_ADAPTER, {
        configurable: false,
        enumerable: false,
        value: { output: taskOptions.output },
        writable: false,
      })
      return adapter as EffectTaskAdapterFor<C, D, P>
    },
    async dispose() {
      if (disposed || !ownsRuntime) return
      disposed = true
      await runtime.dispose()
    },
  }
}
