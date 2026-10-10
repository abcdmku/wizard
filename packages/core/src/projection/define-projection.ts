/**
 * Projections — client views of a wizard (plan §1.7 / §8.9 / §9.8, ADR-001 case 12).
 *
 * `defineProjection(flow, { expose })` is deny-by-default: it captures the exposure spec as a
 * literal type so the projected `ClientState<F, E>` contains exactly what is listed — picked
 * context keys, the flow `output` only with `output: true`, `progress` only with
 * `progress: true`, and per step `input` (draft) / `output` / `issues` / `error` (with its
 * `mapError` `data`) / nested `child` only where exposed. Base facts per step (`id`, `kind`,
 * `status`, `phase`, `attempt`) and per wizard (`instanceId`, `epoch`, `seq`, `status`,
 * `current`) always cross. Everything else is absent from the type AND from the runtime object
 * (`applyProjection`).
 *
 * `defineProjection(flow, { select })` (v0.2) is the arbitrary alternative: `select` maps the
 * typed wizard state (`Snapshot<F>['state']`) to whatever the client needs; the projected type
 * is its return type. The two forms are mutually exclusive; both are `Projection<F, S>` where
 * `S` is the projected state type (what Mirror frames carry).
 *
 * A projection keeps a reference to the `Flow` object it was defined for; `wizard.project()`
 * and `createMirrorSource()` compare by identity (a same-name, same-shape flow is rejected).
 *
 * @packageDocumentation
 */

import type {
  AnyFlow,
  ChildFlowOf,
  Ctx,
  DraftOf,
  ErrorOf,
  FlowOutput,
  Issue,
  KindOf,
  OutputOf,
  Progress,
  SerializedError,
  StepId,
  StepStatus,
  ViewId,
  WizardStatus,
} from '../authoring/types'
import { WizardError } from '../errors'
import type { StepPhase as MachineStepPhase } from '../machine/selectors'
import type { ChildSummary as MachineChildSummary } from '../machine/state'
import type { Snapshot } from '../wizard/create-wizard'

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
 * `error` (with the `mapError` `data`), and — flow steps only — `child`: `true` for the compact
 * `ChildSummary`, or a nested (deny-by-default) spec for the projected child state. Nothing is
 * exposed by default.
 * @public
 */
export type StepExpose<F extends AnyFlow, K extends StepId<F>> = {
  readonly input?: boolean
  readonly output?: boolean
  readonly issues?: boolean
  readonly error?: boolean
} & ([ChildFlowOf<F, K>] extends [never]
  ? {}
  : { readonly child?: boolean | ExposeSpec<ChildFlowOf<F, K>> })

/**
 * What a projection exposes: per-step flags, the context keys that cross the wire, whether the
 * flow `output` does (`output: true`) and whether `progress` does (`progress: true`).
 * @public
 */
export interface ExposeSpec<F extends AnyFlow> {
  readonly steps?: { readonly [K in StepId<F>]?: StepExpose<F, K> }
  readonly context?: readonly (keyof Ctx<F> & string)[]
  readonly output?: boolean
  readonly progress?: boolean
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
 * stack — plus `data`, the task's `mapError` value (`ErrorOf<F, K>`), when it has one.
 * @public
 */
export interface ClientStepError<E> extends SerializedError {
  readonly data?: E
}

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
    ? { readonly child?: ChildSummary }
    : SE extends { readonly child: infer CE extends object }
      ? { readonly child?: ClientState<ChildFlowOf<F, K>, CE, Depth> }
      : {})

/**
 * The projected (client-safe) state of a wizard for exposure spec `E`. `Depth` counts the child
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
      readonly status: WizardStatus
      readonly current: ViewId<F> | null
      readonly context: Pick<Ctx<F>, ExposedContextKeys<F, E>>
      readonly steps: {
        readonly [K in StepId<F>]: ClientStepState<F, K, StepExposeOf<E, K>, Prev[Depth]>
      }
    } & ([E] extends [{ readonly output: true }] ? { readonly output?: FlowOutput<F> } : {}) &
      ([E] extends [{ readonly progress: true }] ? { readonly progress: Progress } : {})

/**
 * A `select` projection's mapper: from the typed wizard state to the projected value.
 * @public
 */
export type ProjectionSelect<F extends AnyFlow, S> = (state: Snapshot<F>['state']) => S

/**
 * A projection of flow `F` producing the client state type `S` — either deny-by-default
 * (`expose`, `S = ClientState<F, E>`) or arbitrary (`select`, `S` = its return type). The
 * `Flow` object it belongs to is compared by identity; `S` is what Mirror frames carry
 * (`ProjectionOutput<P>`).
 * @public
 */
export interface Projection<F extends AnyFlow, S> {
  readonly '~types': { readonly flow: F; readonly state: S } | undefined
  /** The source flow (identity: `wizard.project()` rejects a projection of any other flow object). */
  readonly flow: F
  /** The exposure spec (deny-by-default projections); `undefined` for a `select` projection. */
  readonly expose: ExposeSpec<F> | undefined
  /** The mapper (`select` projections); `undefined` for an `expose` projection. */
  readonly select: ProjectionSelect<F, S> | undefined
}

/**
 * Any projection (the constraint of `ProjectionOutput`, `Mirror`, the React binding): the
 * phantom facts every `Projection<F, S>` carries.
 * @public
 */
export interface AnyProjection {
  readonly '~types': { readonly flow: AnyFlow; readonly state: unknown } | undefined
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

/**
 * Define a projection of a flow. `{ expose }`: deny-by-default — only the listed step inputs /
 * outputs / issues / errors, child summaries or specs, context keys, the flow output (`output:
 * true`) and `progress` (`progress: true`) cross the wire (`wizard.project(projection)` →
 * `ClientState<F, E>`). `{ select }`: an arbitrary typed mapper over the wizard state
 * (`wizard.project(projection)` → its return type). The two are mutually exclusive.
 * @public
 */
export function defineProjection<
  F extends AnyFlow,
  const E extends ExposeSpec<F>,
  S = ClientState<F, E>,
>(
  flow: F,
  options:
    | { readonly expose: E; readonly select?: undefined }
    | { readonly expose?: undefined; readonly select: ProjectionSelect<F, S> },
): Projection<F, S> {
  const { expose, select } = options
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
  return { '~types': undefined, flow, expose, select: select as ProjectionSelect<F, S> | undefined }
}
