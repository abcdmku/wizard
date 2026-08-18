/**
 * Projections — deny-by-default client views of a wizard (plan §1.7 / §8.9, ADR-001 case 12).
 *
 * `defineProjection(flow, { expose })` captures the exposure spec as a literal type so the
 * projected `ClientState<F, E>` contains exactly what is listed: picked context keys, the flow
 * `output` only with `output: true`, and per step `input` (draft) / `output` / `issues` /
 * `error` / nested `child` only where exposed. Base facts per step (`id`, `kind`, `status`,
 * `phase`, `attempt`) and per wizard (`instanceId`, `epoch`, `seq`, `status`, `current`) always
 * cross. Everything else is absent from the type AND from the runtime object (`applyProjection`).
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
  FlowOutput,
  Issue,
  KindOf,
  OutputOf,
  SerializedError,
  StepId,
  StepStatus,
  ViewId,
  WizardStatus,
} from '../authoring/types'
import type { StepPhase as MachineStepPhase } from '../machine/selectors'
import type { ChildSummary as MachineChildSummary } from '../machine/state'

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
 * `error`, and — flow steps only — `child`: `true` for the compact `ChildSummary`, or a nested
 * (deny-by-default) spec for the projected child state. Nothing is exposed by default.
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
 * What a projection exposes: per-step flags, the context keys that cross the wire, and whether
 * the flow `output` does (`output: true`).
 * @public
 */
export interface ExposeSpec<F extends AnyFlow> {
  readonly steps?: { readonly [K in StepId<F>]?: StepExpose<F, K> }
  readonly context?: readonly (keyof Ctx<F> & string)[]
  readonly output?: boolean
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
  ([SE] extends [{ readonly error: true }] ? { readonly error?: SerializedError } : {}) &
  ([SE] extends [{ readonly child: true }]
    ? { readonly child?: ChildSummary }
    : SE extends { readonly child: infer CE extends object }
      ? { readonly child?: ClientState<ChildFlowOf<F, K>, CE, Depth> }
      : {})

/**
 * The projected (client-safe) state of a wizard for exposure spec `E`. `Depth` counts the child
 * edges still allowed: 8 real child levels below the root are typed precisely, deeper ones are
 * `ClientStateFallback`. The flow `output` is present only with `expose.output: true`.
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
    } & ([E] extends [{ readonly output: true }] ? { readonly output?: FlowOutput<F> } : {})

/**
 * A projection: the `Flow` object it belongs to (compared by identity), its exposure spec, and
 * (phantom) the expose literal type. The projected type is derived (`ProjectionOutput<P>`),
 * which keeps `F` covariant.
 * @public
 */
export interface Projection<F extends AnyFlow, E> {
  readonly '~types': { readonly flow: F; readonly expose: E } | undefined
  /** The source flow (identity: `wizard.project()` rejects a projection of any other flow object). */
  readonly flow: F
  readonly expose: E
}

/**
 * Any projection (the constraint of `ProjectionOutput`).
 * @public
 */
export type AnyProjection = Projection<AnyFlow, unknown>

/**
 * The flow type a projection was defined for.
 * @public
 */
export type ProjectionFlow<P extends AnyProjection> = NonNullable<P['~types']>['flow']

/**
 * The exposure spec type of a projection.
 * @public
 */
export type ProjectionExpose<P extends AnyProjection> = NonNullable<P['~types']>['expose']

/**
 * The projected state type of a projection (`ClientState` of its flow for its exposure spec).
 * @public
 */
export type ProjectionOutput<P extends AnyProjection> = ClientState<
  ProjectionFlow<P>,
  ProjectionExpose<P>
>

/**
 * Define a deny-by-default projection of a flow: only the listed step inputs / outputs / issues /
 * errors, child summaries or specs, context keys and (with `output: true`) the flow output cross
 * the wire (`wizard.project(projection)`).
 * @public
 */
export function defineProjection<F extends AnyFlow, const E extends ExposeSpec<F>>(
  flow: F,
  options: { readonly expose: E },
): Projection<F, E> {
  return { '~types': undefined, flow, expose: options.expose }
}
