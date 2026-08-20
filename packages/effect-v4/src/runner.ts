import {
  createTaskFailure,
  type RunArgs,
  TASK_ADAPTER,
  type TaskAdapter,
  type TaskFailureKind,
} from '@openwizard/core'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect'
import type * as LayerModule from 'effect/Layer'
import type * as ManagedRuntimeModule from 'effect/ManagedRuntime'
import type { ManagedRuntime as ManagedRuntimeType } from 'effect/ManagedRuntime'

/** Per-task tracing metadata. @public */
export interface EffectV4TraceOptions<C, D> {
  readonly name?: string | ((args: RunArgs<C, D>) => string)
  readonly attributes?:
    | Readonly<Record<string, unknown>>
    | ((args: RunArgs<C, D>) => Readonly<Record<string, unknown>>)
}

/** Required durable boundaries and optional tracing for an Effect v4 task. @public */
export interface EffectV4TaskOptions<C, D, A, E> {
  /** Required durable boundary for the task success value. */
  readonly output: StandardSchemaV1<unknown, A>
  /** Required durable boundary for the typed Effect failure value. */
  readonly error: StandardSchemaV1<unknown, E>
  readonly trace?: false | EffectV4TraceOptions<C, D>
}

/** Defaults applied to every v4 task created by a runner. @public */
export interface EffectV4RunnerOptions {
  readonly trace?: false | EffectV4TraceOptions<unknown, unknown>
}

type MissingServices<Need, Provided> = [Need] extends [Provided]
  ? unknown
  : {
      readonly '~missing-effect-v4-services': Exclude<Need, Provided>
    }

type EffectSuccess<P> = P extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type EffectError<P> = P extends Effect.Effect<infer _A, infer E, infer _R> ? E : never
type EffectServices<P> = P extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type EffectTaskOptionsFor<C, D, P, Provided> = [P] extends [
  Effect.Effect<unknown, unknown, unknown>,
]
  ? EffectV4TaskOptions<C, D, EffectSuccess<P>, EffectError<P>> &
      MissingServices<EffectServices<P>, Provided>
  : never
type EffectTaskAdapterFor<C, D, P> = [P] extends [Effect.Effect<unknown, unknown, unknown>]
  ? TaskAdapter<C, D, EffectSuccess<P>, EffectError<P>>
  : never

/** A v4 runner whose task methods preserve the Effect success/error/service channels. @public */
export interface EffectV4Runner<Provided> {
  task<C, D, P>(
    body: (args: RunArgs<C, D>) => P,
    options: NoInfer<EffectTaskOptionsFor<C, D, P, Provided>>,
  ): EffectTaskAdapterFor<C, D, P>
  /** Dispose a Layer-created runtime; a supplied ManagedRuntime remains caller-owned. */
  dispose(): Promise<void>
}

type RuntimeRequirements<T extends ManagedRuntimeType<never, unknown>> =
  ManagedRuntimeModule.ManagedRuntime.Services<T>
type LayerRequirements<T extends Layer.Layer<never, unknown, never>> = LayerModule.Success<T>
type RuntimeProvided<T> =
  T extends ManagedRuntimeType<never, unknown> ? RuntimeRequirements<T> : never
type LayerProvided<T> = T extends Layer.Layer<never, unknown, never> ? LayerRequirements<T> : never

interface ClassifiedFailure {
  readonly kind: TaskFailureKind
  readonly error: unknown
}

function isManagedRuntime(value: unknown): value is ManagedRuntimeType<unknown, unknown> {
  return ManagedRuntime.isManagedRuntime(value)
}

/**
 * v4 Cause is a flat list of typed failures, defects, and interruptions. A
 * mixed cause is deliberately treated as a defect so typed durable data is
 * only persisted for a pure typed failure.
 */
function classifyCause(cause: Cause.Cause<unknown>): ClassifiedFailure {
  const reasons = cause.reasons
  const first = reasons[0]
  const typed = first !== undefined && Cause.isFailReason(first) ? first : undefined
  if (typed !== undefined && reasons.every(Cause.isFailReason)) {
    return { kind: 'typed', error: typed.error }
  }
  if (first !== undefined && reasons.every(Cause.isInterruptReason)) {
    return {
      kind: 'interrupted',
      error: new Error('Effect v4 fiber interrupted'),
    }
  }
  const defect = reasons.find(Cause.isDieReason)
  return {
    kind: 'defect',
    error: defect?.defect ?? new Error('Effect v4 fiber failed'),
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
      new Error(`Effect v4 error schema rejected its failure: ${schemaIssues(failure)}`),
      { code: 'EFFECT_V4_ERROR_SCHEMA_REJECTED' },
    )
  }
  return result.value
}

function traceOptions<C, D>(
  trace: false | EffectV4TraceOptions<C, D> | undefined,
  args: RunArgs<C, D>,
): { readonly name: string; readonly attributes?: Record<string, unknown> } | false {
  if (trace === false) return false
  const name = typeof trace?.name === 'function' ? trace.name(args) : trace?.name
  const attributes =
    typeof trace?.attributes === 'function' ? trace.attributes(args) : trace?.attributes
  return {
    name: name ?? 'openwizard.effect-v4.task',
    ...(attributes !== undefined ? { attributes: { ...attributes } } : {}),
  }
}

function executeEffect<C, D, A, E, Need>(
  runtime: ManagedRuntimeType<Need, unknown>,
  body: (args: RunArgs<C, D>) => Effect.Effect<A, E, Need>,
  args: RunArgs<C, D>,
  errorSchema: StandardSchemaV1<unknown, E>,
  trace: false | EffectV4TraceOptions<C, D> | undefined,
  defaultTrace: false | EffectV4TraceOptions<unknown, unknown> | undefined,
): Promise<A> {
  let program: Effect.Effect<A, E, Need>
  try {
    program = body(args)
    const effectiveTrace =
      trace === undefined ? (defaultTrace as false | EffectV4TraceOptions<C, D> | undefined) : trace
    const span = traceOptions(effectiveTrace, args)
    if (span !== false) {
      program = Effect.withSpan(
        program,
        span.name,
        span.attributes === undefined ? undefined : { attributes: span.attributes },
      ) as Effect.Effect<A, E, Need>
    }
  } catch (error) {
    return Promise.reject(createTaskFailure('defect', error))
  }

  return new Promise<A>((resolve, reject) => {
    let fiber: ReturnType<typeof runtime.runFork>
    try {
      // Effect v4's RunOptions.signal is the idiomatic cancellation bridge:
      // aborting the FlowRun signal interrupts this one durable-attempt fiber.
      fiber = runtime.runFork(program, { signal: args.signal as unknown as AbortSignal })
    } catch (error) {
      reject(createTaskFailure('defect', error))
      return
    }

    let settled = false
    let removeObserver = (): void => undefined
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      removeObserver()
      callback()
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

    removeObserver = fiber.addObserver(observe)
  })
}

/** Create an Effect 4 task runner from a managed runtime or closed Layer. @public */
export function makeEffectV4Runner<RT>(
  source: RT,
  options?: EffectV4RunnerOptions,
  ..._check: RT extends ManagedRuntimeType<never, unknown> ? [] : [never]
): EffectV4Runner<RuntimeProvided<RT>>
export function makeEffectV4Runner<L>(
  source: L,
  options?: EffectV4RunnerOptions,
  ..._check: L extends Layer.Layer<never, unknown, never> ? [] : [never]
): EffectV4Runner<LayerProvided<L>>
export function makeEffectV4Runner(
  source: ManagedRuntimeType<unknown, unknown> | Layer.Layer<unknown, unknown, never>,
  options: EffectV4RunnerOptions = {},
  ..._check: readonly unknown[]
): EffectV4Runner<unknown> {
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
      type R = EffectServices<P>
      const adapter = ((args: RunArgs<C, D>) =>
        executeEffect(
          runtime as ManagedRuntimeType<R, unknown>,
          body as (args: RunArgs<C, D>) => Effect.Effect<A, E, R>,
          args,
          taskOptions.error as StandardSchemaV1<unknown, E>,
          taskOptions.trace,
          options.trace as false | EffectV4TraceOptions<unknown, unknown> | undefined,
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
