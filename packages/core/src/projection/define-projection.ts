/**
 * A projection defines the state and transient progress allowed across a transport.
 *
 * `defineProjection(wizard, { expose })` includes base run/step facts and only the listed
 * context keys, inputs, outputs, issues, errors and children. `expose.progress: true` adds
 * completion counters; `expose.waitingFor: true` adds flat waits. A step's transient events
 * need its own `steps[id].progress: true`, including inside each nested child exposure.
 *
 * `defineProjection(wizard, { select, progress? })` maps the typed state to any selected value.
 * Transient events require explicit per-step entries in `progress`, independently of that
 * value. Adding a `scope` boundary changes the mapper argument to `{ state, scope }` and makes
 * that principal required by `run.project` and `createMirrorSource`. Scope stays server-side.
 *
 * A wizard and its provided variants share projection identity. A separately authored
 * same-name, same-shape definition is rejected.
 *
 * @packageDocumentation
 */

import { isBoundary } from '../authoring/boundary'
import type {
  AnyFlow,
  Boundary,
  ChildFlowOf,
  Ctx,
  DraftOf,
  ErrorOf,
  FlowOutput,
  IsEach,
  Issue,
  KindOf,
  OutputOf,
  Progress,
  RunStatus,
  SerializedError,
  StepId,
  StepStatus,
  ViewId,
} from '../authoring/types'
import { WizardError } from '../errors'
import type { StepPhase as MachineStepPhase } from '../machine/selectors'
import type { ChildSummary as MachineChildSummary } from '../machine/state'
import type { Snapshot } from '../wizard/create-wizard'
import type { WaitingFor } from '../wizard/results'

/**
 * Live phase of a step as seen by UIs (`blocked | ready | entering | validating | running |
 * retrying | waiting | exiting | compensating`); absent when the step has no live phase.
 * @public
 */
export type StepPhase = MachineStepPhase

/**
 * Compact status of a child flow as stored on the parent's flow step (`status`, `current`,
 * `progress` 0..1, `seq`) — what `child: true` exposes.
 * @public
 */
export type ChildSummary = MachineChildSummary

/**
 * Exposure of one step: its draft `input`, its `output`, its validation `issues`, its sanitized
 * `error` (with the `mapError` `data`), its hook `progress(value)` events (`progress: true`:
 * forwarded to mirrors as transient progress frames, `mirror.observe()`; never in the state), and
 * — flow steps only — `child`: `true` for the compact `ChildSummary`, or a nested
 * spec for projected child state. Mapped children use arrays in input order, with `null` for
 * children not created yet. Nothing is exposed by default.
 * @public
 */
export type StepExpose<F extends AnyFlow, K extends StepId<F>> = {
  readonly input?: boolean
  readonly output?: boolean
  readonly issues?: boolean
  readonly error?: boolean
  readonly progress?: boolean
} & ([ChildFlowOf<F, K>] extends [never]
  ? {}
  : { readonly child?: boolean | ExposeSpec<ChildFlowOf<F, K>> })

/**
 * What a projection exposes: per-step flags, the context keys that cross the wire, whether the
 * flow `output` does (`output: true`) and whether the `progress` summary (`{ done, total,
 * ratio }`) does (`progress: true`; a step's hook progress events need its own `progress: true`).
 * @public
 */
export interface ExposeSpec<F extends AnyFlow> {
  readonly steps?: { readonly [K in StepId<F>]?: StepExpose<F, K> }
  readonly context?: readonly (keyof Ctx<F> & string)[]
  readonly output?: boolean
  readonly progress?: boolean
  /** Flat waits, with paths relative to the projected run. */
  readonly waitingFor?: boolean
}

/**
 * Transient progress selected by step. `true` exposes that step's own progress events; a child
 * wizard's events require its own nested `child` map. This does not add fields to projected state.
 * @public
 */
export type ProgressSpec<F extends AnyFlow> = {
  readonly [K in StepId<F>]?:
    | boolean
    | ({ readonly progress?: boolean } & ([ChildFlowOf<F, K>] extends [never]
        ? { readonly child?: never }
        : { readonly child?: ProgressSpec<ChildFlowOf<F, K>> }))
}

/** Depth budget: `Prev[D]` = one child edge deeper; `Prev[0]` = `never` = beyond the budget. */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7]
type StepExposeOf<E, K extends PropertyKey> = E extends { readonly steps: infer S }
  ? K extends keyof S
    ? S[K]
    : undefined
  : undefined
type ExposedContextKeys<F extends AnyFlow, E> = E extends {
  readonly context: readonly (infer CK)[]
}
  ? Extract<CK, keyof Ctx<F>>
  : never

/**
 * Placeholder type once nesting exceeds the depth budget (8 child levels below the root).
 * @public
 */
export interface ClientStateFallback {
  readonly '~depth': 'exceeded'
}

/**
 * A step error as a projection exposes it (`error: true`): `{ name, message, code? }` — never a
 * stack — plus `data`, the runnable step's `mapError` value (`ErrorOf<F, K>`), when present.
 * @public
 */
export interface ClientStepError<E> extends SerializedError {
  readonly data?: E
}

type ClientChild<F extends AnyFlow, K extends StepId<F>, S> =
  boolean extends IsEach<F, K>
    ? S | readonly (S | null)[]
    : true extends IsEach<F, K>
      ? readonly (S | null)[]
      : S

/**
 * Projected state of one step: base facts (`id`, `kind`, `status`, `phase`, `attempt`) plus
 * `input` / `output` / `issues` / `error` / `child` exactly where exposed. `Depth` is the number
 * of child levels still allowed below this step.
 * @public
 */
export type ClientStepState<F extends AnyFlow, K extends StepId<F>, SE, Depth extends number> = {
  readonly id: K
  readonly kind: KindOf<F, K>
  readonly status: StepStatus
  readonly phase?: StepPhase
  readonly attempt: number
} & ([SE] extends [{ readonly input: true }] ? { readonly input?: DraftOf<F, K> } : {}) &
  ([SE] extends [{ readonly output: true }] ? { readonly output?: OutputOf<F, K> } : {}) &
  ([SE] extends [{ readonly issues: true }] ? { readonly issues?: readonly Issue[] } : {}) &
  ([SE] extends [{ readonly error: true }]
    ? { readonly error?: ClientStepError<ErrorOf<F, K>> }
    : {}) &
  ([SE] extends [{ readonly child: true }]
    ? { readonly child?: ClientChild<F, K, ChildSummary> }
    : SE extends { readonly child: infer CE extends object }
      ? { readonly child?: ClientChild<F, K, ClientState<ChildFlowOf<F, K>, CE, Depth>> }
      : {})

/**
 * The projected (client-safe) state of a run for exposure spec `E`. `Depth` counts the child
 * edges still allowed: 8 real child levels below the root are typed precisely, deeper ones are
 * `ClientStateFallback`. The flow `output` is present only with `expose.output: true`,
 * `progress` only with `expose.progress: true`.
 * @public
 */
export type ClientState<F extends AnyFlow, E, Depth extends number = 8> = [Depth] extends [never]
  ? ClientStateFallback
  : {
      readonly instanceId: string
      readonly epoch: number
      readonly seq: number
      readonly status: RunStatus
      readonly current: ViewId<F> | null
      readonly context: Pick<Ctx<F>, ExposedContextKeys<F, E>>
      readonly steps: {
        readonly [K in StepId<F>]: ClientStepState<F, K, StepExposeOf<E, K>, Prev[Depth]>
      }
    } & ([E] extends [{ readonly output: true }] ? { readonly output?: FlowOutput<F> } : {}) &
      ([E] extends [{ readonly progress: true }] ? { readonly progress: Progress } : {}) &
      ([E] extends [{ readonly waitingFor: true }]
        ? { readonly waitingFor: readonly WaitingFor<F>[] }
        : {})

/**
 * A `select` projection's mapper: from the typed run state to the projected value.
 * @public
 */
export type ProjectionSelect<F extends AnyFlow, S, Scope = never> = [Scope] extends [never]
  ? (state: Snapshot<F>['state']) => S
  : (input: { readonly state: Snapshot<F>['state']; readonly scope: Scope }) => S

/**
 * A projection of flow `F` producing the client state type `S` — either deny-by-default
 * (`expose`, `S = ClientState<F, E>`) or arbitrary (`select`, `S` = its return type). The
 * `Flow` object it belongs to is compared by identity; `S` is what Mirror frames carry
 * (`ProjectionOutput<P>`).
 * @public
 */
export interface Projection<F extends AnyFlow, S, Scope = never> {
  readonly '~types': { readonly flow: F; readonly state: S; readonly scope: Scope } | undefined
  /** The authored source wizard. Provided variants share its identity; separately authored definitions do not. */
  readonly flow: F
  /** The exposure spec (deny-by-default projections); `undefined` for a `select` projection. */
  readonly expose: ExposeSpec<F> | undefined
  /** Per-step transient progress allowed by a `select` projection; absent means no events. */
  readonly progress: ProgressSpec<F> | undefined
  /** Principal boundary for a scoped `select`; `undefined` for unscoped projections. */
  readonly scope: [Scope] extends [never] ? undefined : Boundary<Scope, Scope>
  /** The mapper (`select` projections); `undefined` for an `expose` projection. */
  readonly select: ProjectionSelect<F, S, Scope> | undefined
}

/**
 * Any projection (the constraint of `ProjectionOutput`, `Mirror`, the React binding): the
 * phantom facts every `Projection<F, S>` carries.
 * @public
 */
export interface AnyProjection {
  readonly '~types':
    | {
        readonly flow: AnyFlow
        readonly state: unknown
        readonly scope: unknown
      }
    | undefined
  readonly flow: AnyFlow
}

/**
 * The flow type a projection was defined for.
 * @public
 */
export type ProjectionFlow<P extends AnyProjection> = NonNullable<P['~types']>['flow']

/**
 * The projected state type of a projection (`ClientState` of its flow for its exposure spec, or
 * the `select` mapper's return type).
 * @public
 */
export type ProjectionOutput<P extends AnyProjection> = NonNullable<P['~types']>['state']

/** The principal type required by a scoped projection, or `never` when it is unscoped.
 * @public
 */
export type ProjectionScope<P extends AnyProjection> = NonNullable<P['~types']>['scope']

/**
 * Define a projection of a wizard. `{ expose }` returns only the selected fields and base facts.
 * `{ select }` returns its mapper's result, and `progress` separately allows transient step events.
 * The two state definitions are mutually exclusive.
 * @public
 */
export function defineProjection<
  F extends AnyFlow,
  const E extends ExposeSpec<F> = never,
  S = unknown,
  Scope = never,
>(
  wizard: F,
  options:
    | {
        readonly expose: E
        readonly scope?: never
        readonly select?: undefined
        readonly progress?: never
      }
    | {
        readonly expose?: undefined
        readonly scope?: Boundary<Scope, Scope>
        readonly select: ProjectionSelect<F, S, Scope>
        readonly progress?: ProgressSpec<F>
      },
): Projection<F, [E] extends [never] ? S : ClientState<F, E>, Scope> {
  const { expose, scope, select, progress } = options
  // The parameter type makes this a compile-time error; JS callers get the same rule at runtime.
  if ((expose === undefined) === (select === undefined)) {
    throw new WizardError(
      'DEFINITION_INVALID',
      'defineProjection: give exactly one of `expose` (deny-by-default) or `select` (mapper)',
    )
  }
  if (expose !== undefined && (typeof expose !== 'object' || expose === null)) {
    throw new WizardError('DEFINITION_INVALID', 'defineProjection: `expose` must be an object')
  }
  if (select !== undefined && typeof select !== 'function') {
    throw new WizardError('DEFINITION_INVALID', 'defineProjection: `select` must be a function')
  }
  if (Object.hasOwn(options, 'scope') && !isBoundary(scope)) {
    throw new WizardError('DEFINITION_INVALID', 'defineProjection: `scope` must be a boundary')
  }
  if (scope !== undefined && expose !== undefined) {
    throw new WizardError(
      'DEFINITION_INVALID',
      'defineProjection: `scope` is only valid with a `select` mapper',
    )
  }
  if (
    progress !== undefined &&
    (expose !== undefined ||
      typeof progress !== 'object' ||
      progress === null ||
      Array.isArray(progress))
  ) {
    throw new WizardError(
      'DEFINITION_INVALID',
      'defineProjection: `progress` must be a per-step map with a `select` mapper',
    )
  }
  return {
    '~types': undefined,
    flow: wizard,
    expose,
    progress,
    ...(scope === undefined ? {} : { scope }),
    select: select as ProjectionSelect<AnyFlow, unknown, unknown> | undefined,
  } as Projection<F, [E] extends [never] ? S : ClientState<F, E>, Scope>
}
