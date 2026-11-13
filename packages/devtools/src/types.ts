/**
 * Public types of `@openwizard/devtools`. The components accept a live `Run` or a `Mirror`
 * through STRUCTURAL source types (`RunSource` / `MirrorSource`) so any typed
 * `Run<F>` / `Mirror<P>` fits without a cast, and read the wizard's static graph as the
 * `Manifest` `inspect(wizard)` returns.
 *
 * @packageDocumentation
 */

import type {
  AnyWizardDefinition,
  Explanation,
  RunEvent,
  Snapshot,
  StepKind,
  StepStatus,
} from '@openwizard/core'
import type { Manifest } from '@openwizard/core/inspect'

/**
 * Colour scheme of the devtools: `'system'` follows `prefers-color-scheme`, the others force it
 * (`data-theme` on the root element; every colour is a `--owd-*` CSS variable).
 * @public
 */
export type DevtoolsTheme = 'light' | 'dark' | 'system'

/**
 * Live phase of a step as `run.explain(step).phase` / `ClientStepState.phase` report it
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
  /** The current attempt (1 on the first run) when the snapshot records one. */
  readonly attempt?: number
}

/**
 * Statuses keyed by step key (`stepKey(path, id)`: the step id for the root wizard,
 * `'fulfil/pick'` for an ordinary child or `'batch/0/pick'` for a mapped child). Built with
 * `collectStatuses()` from a run snapshot or a projected (`ClientState`) state, or by hand.
 * @public
 */
export type StepStatusMap = Readonly<Record<string, StepStatusInfo>>

/**
 * What a graph click reports: the step `id`, the run `path` of its wizard and the combined
 * `key` (`stepKey(path, id)`).
 * Mapped children carry their input index after the owning step, e.g. `['batch', '0']`.
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
 * A run snapshot as the devtools walk it: the (typed-erased) state plus the live children by
 * child step id. `Run.getSnapshot()` of any wizard returns one.
 * @public
 */
export interface SnapshotLike {
  readonly state: Snapshot<AnyWizardDefinition>['state']
  readonly children: Readonly<Record<string, SnapshotLike | undefined>>
}

/**
 * The structural view of a `Run` the devtools read (`Run<F>` of any wizard satisfies it):
 * identity, the wizard, state / snapshot, the two subscriptions, the bounded log, `explain` and
 * the live child handles.
 * @public
 */
export interface RunSource {
  readonly id: string
  readonly wizard: AnyWizardDefinition
  getState(): Snapshot<AnyWizardDefinition>['state']
  getSnapshot(): SnapshotLike
  subscribe(listener: () => void): () => void
  observe(listener: (event: RunEvent) => void): () => void
  log(): readonly RunEvent[]
  explain(step: string): Explanation
  /** Live child, optionally selected by mapped item key or index. Throws when it is not live. */
  child(step: string, keyOrIndex?: number | string): Pick<RunSource, 'explain' | 'child'>
}

/**
 * The structural view of a `Mirror` the devtools read (`Mirror<P>` of any projection satisfies
 * it): the projected state (`null` before the first frame), its subscription and the frame
 * identity. Events, `explain` and the timeline need a run; a Mirror source shows the graph
 * (with `wizard` / `graph`) and the projected step facts.
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
 * What the components accept as `source`: a live `Run` or a `Mirror`.
 * @public
 */
export type DevtoolsSource = RunSource | MirrorSource

/**
 * True for a `RunSource` (it has `getState` / `log` / `explain`); false for a Mirror (which
 * also has `observe`).
 * @public
 */
export function isRunSource(source: DevtoolsSource): source is RunSource {
  return 'getState' in source && typeof source.getState === 'function'
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
 * The static graph the components draw: a ready `Manifest` (`inspect(wizard)`, plain JSON — a
 * client can receive it from the server) or the wizard itself (`inspect` is called for you);
 * `graph` wins when both are given.
 * @public
 */
export interface GraphInput {
  readonly graph?: Manifest
  readonly wizard?: AnyWizardDefinition
}
