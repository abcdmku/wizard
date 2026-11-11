/** A wizard is its declarative definition plus bound run constructors. */

import type { ResumeOptions, Run, RunOptions } from '../../wizard/create-wizard/wizard'
import type { RunOutcome } from '../../wizard/results'
import type { StepError } from './assembly'
import type { Boundary } from './boundary'
import type { DepsOf, RequiredDepsOf } from './extractors'
import type { WizardOnArgs } from './hook-args'
import type { Duration, JsonValue, MaybePromise, RetryPolicy, StepKind } from './primitives'
import type { WizardStep } from './step'

/** Author documentation, copied to the manifest that `inspect` returns. */
interface WizardProse {
  /** What the wizard is for, in a sentence or two. `toMarkdown` prints it under the title. */
  readonly description?: string
  /** JSON data for tools. The runtime never reads it. */
  readonly meta?: Readonly<Record<string, JsonValue>>
}
interface WizardPolicies {
  /** What happens when a step fails for good with no `fallback`. Default `'halt'`. */
  readonly onFailure?: 'halt' | 'compensate'
  readonly retry?: RetryPolicy
  readonly autoRun?: 'ready' | 'manual'
  readonly concurrency?: number
  readonly unmatchedEvents?: { readonly buffer: boolean; readonly ttl: Duration }
}
/** Definition header with context, event and dependency boundaries. @public */
export interface WizardHeader<C, CIn, Ev, D, O, EvIn = Ev> extends WizardPolicies, WizardProse {
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
      args: WizardOnArgs<C, D, Ev[E], E>,
    ) => MaybePromise<void | { readonly cancel: string }>
  }>
  readonly correlate?: NoInfer<{
    readonly [E in keyof Ev]?: (payload: Ev[E]) => string | undefined
  }>
}

/** The type facts of a wizard. `provided` holds the dependency keys bound by `provide()`. @public */
export interface WizardTypes<C, CIn, Ev, D, T, O, P extends PropertyKey, EvIn = Ev> {
  readonly ctx: C
  readonly ctxIn: CIn
  readonly events: Ev
  readonly eventsIn: EvIn
  readonly deps: D
  readonly steps: T
  readonly output: O
  readonly provided: P
}

/** The declarative definition accepted by inspectors and by code that only reads a wizard. @public */
export interface WizardDefinition<
  C,
  CIn,
  Ev,
  D,
  T,
  O = never,
  P extends PropertyKey = never,
  EvIn = Ev,
> extends WizardPolicies,
    WizardProse {
  readonly '~types': WizardTypes<C, CIn, Ev, D, T, O, P, EvIn> | undefined
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
/** A structural constraint for code that reads any wizard definition. @public */
export type AnyWizardDefinition = WizardDefinition<
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
export type WizardOptions<F extends AnyWizardDefinition> = Omit<RunOptions<F>, 'context' | 'deps'> &
  ({} extends RequiredDepsOf<F>
    ? { readonly deps?: Partial<DepsOf<F>> }
    : { readonly deps: RequiredDepsOf<F> & Partial<DepsOf<F>> })
/** Restore options with run identity taken from the snapshot. @public */
export type WizardResumeOptions<F extends AnyWizardDefinition> = Omit<
  WizardOptions<F>,
  'instanceId' | 'correlationId'
> &
  Pick<ResumeOptions<F>, 'migrate'>

type SureKeys<Q> = { [K in keyof Q]-?: {} extends Pick<Q, K> ? never : K }[keyof Q]
type OptionsArgs<O> = {} extends O ? [options?: O] : [options: O]

/**
 * A definition with bound creation, resume, execution and dependency methods. `provide()` returns a new wizard.
 * @public
 */
export interface Wizard<C, CIn, Ev, D, T, O = never, P extends PropertyKey = never, EvIn = Ev>
  extends WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn> {
  create(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Run<this>
  createAsync(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Promise<Run<this>>
  resume(
    snapshot: unknown,
    ...options: OptionsArgs<WizardResumeOptions<WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Run<this>
  resumeAsync(
    snapshot: unknown,
    ...options: OptionsArgs<WizardResumeOptions<WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Promise<Run<this>>
  /** Runs until done, failed, cancelled, halted or waiting on a view/event; never hangs or throws for step failures. */
  run(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn>>>
  ): Promise<RunOutcome<this>>
  /** Like `run`, synchronously; throws `SYNC_VIOLATION` naming the step when work cannot finish synchronously. */
  runSync(
    input: CIn,
    ...options: OptionsArgs<WizardOptions<WizardDefinition<C, CIn, Ev, D, T, O, P, EvIn>>>
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
  readonly [id: string]: WizardStep<StepKind, any, 'sink'>
}
export type RoleIn<S> = S extends { readonly '~role': infer R } ? NonNullable<R> : never
export type OutputIn<S> = S extends { readonly '~types': infer X }
  ? NonNullable<X> extends { readonly output: infer O }
    ? O
    : never
  : never

/**
 * A structural constraint for adapters that create or resume wizard runs.
 * Durable hosts and registries use it.
 * @public
 */
export type AnyWizard = AnyWizardDefinition & {
  create(input: never, ...options: never[]): unknown
  resume(snapshot: unknown, ...options: never[]): unknown
}
