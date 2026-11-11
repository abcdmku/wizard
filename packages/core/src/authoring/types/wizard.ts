/** A wizard is its declarative flow plus bound run constructors. */

import type { ResumeOptions, Run, RunOptions } from '../../wizard/create-wizard/wizard'
import type { RunOutcome } from '../../wizard/results'
import type { StepError } from './assembly'
import type { Boundary } from './boundary'
import type { DepsOf, RequiredDepsOf } from './extractors'
import type { FlowOnArgs } from './hook-args'
import type { Duration, MaybePromise, RetryPolicy, StepKind } from './primitives'
import type { FlowStep, SinkRole, StepFacts } from './step'

export interface WizardPolicies {
  /** What happens when a step fails for good with no `fallback`. Default `'halt'`. */
  readonly onFailure?: 'halt' | 'compensate'
  readonly retry?: RetryPolicy
  readonly autoRun?: 'ready' | 'manual'
  readonly concurrency?: number
  readonly unmatchedEvents?: { readonly buffer: boolean; readonly ttl: Duration }
}
/** Definition header with context, event and dependency boundaries. @public */
export interface WizardDefinition<C, CIn, Ev, D, O, EvIn = Ev> extends WizardPolicies {
  readonly name: string
  readonly version?: number
  readonly context: Boundary<C, CIn>
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> } & {
    readonly [E in keyof EvIn]: Boundary<unknown, EvIn[E]>
  }
  readonly deps?: Boundary<D, unknown>
  /** Output selector; without it the output is the last completed sink step's output. */
  readonly output?: (args: {
    readonly context: NoInfer<C>
  }) => O & (O extends PromiseLike<unknown> ? never : unknown)
  readonly on?: NoInfer<{
    readonly [E in keyof Ev]?: (
      args: FlowOnArgs<C, D, Ev[E], E>,
    ) => MaybePromise<void | { readonly cancel: string }>
  }>
  readonly correlate?: NoInfer<{
    readonly [E in keyof Ev]?: (payload: Ev[E]) => string | undefined
  }>
}

/** Phantom facts of a flow; `provided` holds the dep keys bound by `provide()`. */
export interface FlowTypes<C, CIn, Ev, D, T, O, P extends PropertyKey, EvIn = Ev> {
  readonly ctx: C
  readonly ctxIn: CIn
  readonly events: Ev
  readonly eventsIn: EvIn
  readonly deps: D
  readonly steps: T
  readonly output: O
  readonly provided: P
}

/** The declarative definition accepted by inspectors and flow consumers. @public */
export interface Flow<C, CIn, Ev, D, T, O = never, P extends PropertyKey = never, EvIn = Ev>
  extends WizardPolicies {
  readonly '~types': FlowTypes<C, CIn, Ev, D, T, O, P, EvIn> | undefined
  readonly name: string
  readonly version?: number
  readonly context: Boundary<C, CIn>
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> }
  readonly deps?: Boundary<D, unknown>
  readonly providedDeps?: Readonly<Record<string, unknown>>
  readonly on?: { readonly [E in keyof Ev]?: (args: never) => unknown }
  readonly correlate?: { readonly [E in keyof Ev]?: (payload: never) => string | undefined }
  readonly output?: (args: never) => unknown
  readonly steps: T
  readonly start?: string | readonly string[]
}
export interface AnyFlowSteps {
  readonly [id: string]: FlowStep<StepKind, StepFacts, SinkRole>
}
/** A structural constraint for code that reads any flow definition. @public */
export type AnyFlow = Flow<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  PropertyKey,
  unknown
>

export type RemainingDeps<D, P extends PropertyKey> = [P] extends [never]
  ? D
  : { [K in keyof D as K extends P ? never : K]: D[K] }
/** Creation options requiring only dependencies not already provided. @public */
export type WizardOptions<F extends AnyFlow> = Omit<RunOptions<F>, 'context' | 'deps'> &
  ({} extends RequiredDepsOf<F>
    ? { readonly deps?: Partial<DepsOf<F>> }
    : { readonly deps: RequiredDepsOf<F> & Partial<DepsOf<F>> })
/** Restore options with run identity taken from the snapshot. @public */
export type WizardResumeOptions<F extends AnyFlow> = Omit<
  WizardOptions<F>,
  'instanceId' | 'correlationId'
> &
  Pick<ResumeOptions<F>, 'migrate'>

type SureKeys<Q> = { [K in keyof Q]-?: {} extends Pick<Q, K> ? never : K }[keyof Q]
export type OptionsArgs<O> = {} extends O ? [options?: O] : [options: O]

/** A wizard IS its flow, plus run constructors. `provide()` returns a new wizard. */
/** A flow with bound creation, resume, execution and dependency methods. @public */
export interface Wizard<C, CIn, Ev, D, T, O = never, P extends PropertyKey = never, EvIn = Ev>
  extends Flow<C, CIn, Ev, D, T, O, P, EvIn> {
  create(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Run<this>
  createAsync(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Promise<Run<this>>
  resume(
    snapshot: unknown,
    ...options: OptionsArgs<WizardResumeOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Run<this>
  resumeAsync(
    snapshot: unknown,
    ...options: OptionsArgs<WizardResumeOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Promise<Run<this>>
  /** Runs until done, failed, cancelled, halted or waiting on a view/event; never hangs or throws for step failures. */
  run(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Promise<RunOutcome<this>>
  /** Like `run`, synchronously; throws `SYNC_VIOLATION` naming the step when work cannot finish synchronously. */
  runSync(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<Flow<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): RunOutcome<this>
  /** Bind some deps; the rest stay required wherever runs are created. */
  provide<Q extends Partial<D>>(
    deps: Q & {
      readonly [X in Exclude<
        keyof Q,
        keyof D
      >]: StepError<`'${X & string}' is not a dependency of this wizard`>
    },
  ): Wizard<C, CIn, Ev, D, T, O, P | Extract<SureKeys<Q>, keyof D>, EvIn>
}

/**
 * What a wizard's step map degrades to when the `defineWizard` call itself is invalid (e.g. a
 * missing `name`): TypeScript then skips `build`, so ids/outputs are unknown. Loose on purpose,
 * so the one reported error does not cascade into every use of the wizard.
 */
export interface UncheckedSteps {
  // biome-ignore lint/suspicious/noExplicitAny: failure-mode only; see the comment above
  readonly [id: string]: FlowStep<StepKind, any, 'sink'>
}
export type RoleIn<S> = S extends { readonly '~role': infer R } ? NonNullable<R> : never
export type OutputIn<S> = S extends { readonly '~types': infer X }
  ? NonNullable<X> extends { readonly output: infer O }
    ? O
    : never
  : never

/** Structural constraint for code that creates runs of any wizard (durable hosts, registries). */
/** A structural constraint for adapters that create or resume wizard runs. @public */
export type AnyWizard = AnyFlow & {
  create(input: never, ...options: never[]): unknown
  resume(snapshot: unknown, ...options: never[]): unknown
}
