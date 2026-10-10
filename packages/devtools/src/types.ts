/**
 * Public types of `@openwizard/devtools`. The components accept a live `Wizard` or a `Mirror`
 * through STRUCTURAL source types (`WizardSource` / `MirrorSource`) so any typed
 * `Wizard<F>` / `Mirror<P>` fits without a cast, and read the flow's static graph as the
 * `FlowGraph` `inspect(flow)` returns.
 *
 * @packageDocumentation
 */

import type {
  AnyFlow,
  Explanation,
  FlowGraph,
  Snapshot,
  StepKind,
  StepStatus,
  WizardEvent,
} from '@openwizard/core'

/**
 * Colour scheme of the devtools: `'system'` follows `prefers-color-scheme`, the others force it
 * (`data-theme` on the root element; every colour is a `--owd-*` CSS variable).
 * @public
 */
export type DevtoolsTheme = 'light' | 'dark' | 'system'

/**
 * Live phase of a step as `wizard.explain(step).phase` / `ClientStepState.phase` report it
 * (`ready`, `running`, `retrying`, `waiting`, …).
 * @public
 */
export type StepPhase = NonNullable<Explanation['phase']>

/**
 * Live facts of one step for the graph overlay: its stored `status` and, when known, its `phase`.
 * @public
 */
export interface StepStatusInfo {
  readonly status: StepStatus
  readonly phase?: StepPhase
}

/**
 * Statuses keyed by step key (`stepKey(path, id)`: the step id for the root flow,
 * `'fulfil/pick'` for step `pick` of the child flow of `fulfil`). Built with
 * `collectStatuses()` from a wizard snapshot or a projected (`ClientState`) state, or by hand.
 * @public
 */
export type StepStatusMap = Readonly<Record<string, StepStatusInfo>>

/**
 * What a graph click reports: the step `id`, the wizard `path` of its flow and the combined
 * `key` (`stepKey(path, id)`).
 * @public
 */
export interface GraphSelection {
  readonly id: string
  readonly path: readonly string[]
  readonly key: string
}

/**
 * The key of a step in a `StepStatusMap` / graph selection: `[...path, id].join('/')` — the bare
 * id for a root step, `'fulfil/pick'` for a nested one.
 * @public
 */
export function stepKey(path: readonly string[], id: string): string {
  return path.length === 0 ? id : `${path.join('/')}/${id}`
}

/**
 * A wizard snapshot as the devtools walk it: the (typed-erased) state plus the live children by
 * flow-step id. `Wizard.getSnapshot()` of any flow returns one.
 * @public
 */
export interface SnapshotLike {
  readonly state: Snapshot<AnyFlow>['state']
  readonly children: Readonly<Record<string, SnapshotLike | undefined>>
}

/**
 * The structural view of a `Wizard` the devtools read (`Wizard<F>` of any flow satisfies it):
 * identity, the flow, state / snapshot, the two subscriptions, the bounded log, `explain` and
 * the live child handles.
 * @public
 */
export interface WizardSource {
  readonly id: string
  readonly flow: AnyFlow
  getState(): Snapshot<AnyFlow>['state']
  getSnapshot(): SnapshotLike
  subscribe(listener: () => void): () => void
  observe(listener: (event: WizardEvent) => void): () => void
  log(): readonly WizardEvent[]
  explain(step: string): Explanation
  /** Live child of an active flow step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE` otherwise). */
  child(step: string): WizardSource
}

/**
 * The structural view of a `Mirror` the devtools read (`Mirror<P>` of any projection satisfies
 * it): the projected state (`null` before the first frame), its subscription and the frame
 * identity. Events, `explain` and the timeline need a wizard; a Mirror source shows the graph
 * (with `flow` / `graph`) and the projected step facts.
 * @public
 */
export interface MirrorSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
  readonly instanceId: string | null
  readonly epoch: number | null
  readonly seq: number | null
  readonly connected: boolean
}

/**
 * What the components accept as `source`: a live `Wizard` or a `Mirror`.
 * @public
 */
export type DevtoolsSource = WizardSource | MirrorSource

/**
 * True for a `WizardSource` (it has `observe` / `log` / `explain`); false for a Mirror.
 * @public
 */
export function isWizardSource(source: DevtoolsSource): source is WizardSource {
  return 'observe' in source && typeof source.observe === 'function'
}

/**
 * The projected step facts a `ClientState` carries for every step (`ClientStepState` base) plus
 * the optional exposures, as the devtools read them without knowing the projection.
 * @public
 */
export interface ProjectedStep {
  readonly id: string
  readonly kind: StepKind
  readonly status: StepStatus
  readonly phase?: StepPhase
  readonly attempt: number
  readonly input?: unknown
  readonly output?: unknown
  readonly issues?: readonly unknown[]
  readonly error?: unknown
  /** A `ChildSummary` (`child: true`) or a nested `ProjectedState` (`child: { … }`). */
  readonly child?: unknown
}

/**
 * A projected (`ClientState`) state as the devtools read it: `status`, `current`, the exposed
 * `context` keys and the per-step facts.
 * @public
 */
export interface ProjectedState {
  readonly status: string
  readonly current: string | null
  readonly context?: unknown
  readonly steps: Readonly<Record<string, ProjectedStep>>
  readonly seq?: number
  readonly instanceId?: string
  readonly epoch?: number
  readonly output?: unknown
}

/**
 * True when a Mirror's projected value looks like a `ClientState` (an `expose` projection):
 * `status`, `current` and a `steps` map. A `select` projection's value may be anything else.
 * @public
 */
export function isProjectedState(value: unknown): value is ProjectedState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { readonly steps?: unknown; readonly status?: unknown }
  return typeof v.steps === 'object' && v.steps !== null && typeof v.status === 'string'
}

/**
 * The static graph the components draw: a ready `FlowGraph` (`inspect(flow)`, plain JSON — a
 * client can receive it from the server) or the flow itself (`inspect` is called for you);
 * `graph` wins when both are given.
 * @public
 */
export interface GraphInput {
  readonly graph?: FlowGraph
  readonly flow?: AnyFlow
}

/**
 * One node of a `FlowGraph` (`inspect(flow).nodes[i]`): id, kind, path, hooks, `dependsOn`,
 * `timeout`, `dynamicNext`, `start`.
 * @public
 */
export type FlowGraphNode = FlowGraph['nodes'][number]

/**
 * One edge of a `FlowGraph` (`inspect(flow).edges[i]`): `from` (`null` for `start`), `to`, kind, path.
 * @public
 */
export type FlowGraphEdge = FlowGraph['edges'][number]
