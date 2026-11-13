import { Manifest, ManifestEdge, ManifestStep } from "@openwizard/core/inspect";
import { CSSProperties, ReactElement } from "react";
import { AnyWizardDefinition, Explanation, RunEvent, Snapshot, StepKind, StepStatus } from "@openwizard/core";
import { ElkNode } from "elkjs/lib/elk-api";
//#region src/types.d.ts
/**
 * Colour scheme of the devtools: `'system'` follows `prefers-color-scheme`, the others force it
 * (`data-theme` on the root element; every colour is a `--owd-*` CSS variable).
 * @public
 */
type DevtoolsTheme = 'light' | 'dark' | 'system';
/**
 * Live phase of a step as `run.explain(step).phase` / `ClientStepState.phase` report it
 * (`ready`, `running`, `retrying`, `waiting`, …).
 * @public
 */
type StepPhase = NonNullable<Explanation['phase']>;
/**
 * Live facts of one step for the graph overlay: its stored `status` and, when known, its `phase`.
 * @public
 */
interface StepStatusInfo {
  readonly status: StepStatus;
  readonly phase?: StepPhase;
  /** The current attempt (1 on the first run) when the snapshot records one. */
  readonly attempt?: number;
}
/**
 * Statuses keyed by step key (`stepKey(path, id)`: the step id for the root wizard,
 * `'fulfil/pick'` for an ordinary child or `'batch/0/pick'` for a mapped child). Built with
 * `collectStatuses()` from a run snapshot or a projected (`ClientState`) state, or by hand.
 * @public
 */
type StepStatusMap = Readonly<Record<string, StepStatusInfo>>;
/**
 * What a graph click reports: the step `id`, the run `path` of its wizard and the combined
 * `key` (`stepKey(path, id)`).
 * Mapped children carry their input index after the owning step, e.g. `['batch', '0']`.
 * @public
 */
interface GraphSelection {
  readonly id: string;
  readonly path: readonly string[];
  readonly key: string;
}
/**
 * The key of a step in a `StepStatusMap` / graph selection: `[...path, id].join('/')` — the bare
 * id for a root step, `'fulfil/pick'` for a nested one.
 * @public
 */
declare function stepKey(path: readonly string[], id: string): string;
/**
 * A run snapshot as the devtools walk it: the (typed-erased) state plus the live children by
 * child step id. `Run.getSnapshot()` of any wizard returns one.
 * @public
 */
interface SnapshotLike {
  readonly state: Snapshot<AnyWizardDefinition>['state'];
  readonly children: Readonly<Record<string, SnapshotLike | undefined>>;
}
/**
 * The structural view of a `Run` the devtools read (`Run<F>` of any wizard satisfies it):
 * identity, the wizard, state / snapshot, the two subscriptions, the bounded log, `explain` and
 * the live child handles.
 * @public
 */
interface RunSource {
  readonly id: string;
  readonly wizard: AnyWizardDefinition;
  getState(): Snapshot<AnyWizardDefinition>['state'];
  getSnapshot(): SnapshotLike;
  subscribe(listener: () => void): () => void;
  observe(listener: (event: RunEvent) => void): () => void;
  log(): readonly RunEvent[];
  explain(step: string): Explanation;
  /** Live child, optionally selected by mapped item key or index. Throws when it is not live. */
  child(step: string, keyOrIndex?: number | string): Pick<RunSource, 'explain' | 'child'>;
}
/**
 * The structural view of a `Mirror` the devtools read (`Mirror<P>` of any projection satisfies
 * it): the projected state (`null` before the first frame), its subscription and the frame
 * identity. Events, `explain` and the timeline need a run; a Mirror source shows the graph
 * (with `wizard` / `graph`) and the projected step facts.
 * @public
 */
interface MirrorSource {
  getSnapshot(): unknown;
  subscribe(listener: () => void): () => void;
  readonly instanceId: string | null;
  readonly epoch: number | null;
  readonly seq: number | null;
  readonly connected: boolean;
}
/**
 * What the components accept as `source`: a live `Run` or a `Mirror`.
 * @public
 */
type DevtoolsSource = RunSource | MirrorSource;
/**
 * True for a `RunSource` (it has `getState` / `log` / `explain`); false for a Mirror (which
 * also has `observe`).
 * @public
 */
declare function isRunSource(source: DevtoolsSource): source is RunSource;
/**
 * The projected step facts a `ClientState` carries for every step (`ClientStepState` base) plus
 * the optional exposures, as the devtools read them without knowing the projection.
 * @public
 */
interface ProjectedStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly status: StepStatus;
  readonly phase?: StepPhase;
  readonly attempt: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly issues?: readonly unknown[];
  readonly error?: unknown;
  /** A `ChildSummary` (`child: true`) or a nested `ProjectedState` (`child: { … }`). */
  readonly child?: unknown;
}
/**
 * A projected (`ClientState`) state as the devtools read it: `status`, `current`, the exposed
 * `context` keys and the per-step facts.
 * @public
 */
interface ProjectedState {
  readonly status: string;
  readonly current: string | null;
  readonly context?: unknown;
  readonly steps: Readonly<Record<string, ProjectedStep>>;
  readonly seq?: number;
  readonly instanceId?: string;
  readonly epoch?: number;
  readonly output?: unknown;
}
/**
 * True when a Mirror's projected value looks like a `ClientState` (an `expose` projection):
 * `status`, `current` and a `steps` map. A `select` projection's value may be anything else.
 * @public
 */
declare function isProjectedState(value: unknown): value is ProjectedState;
/**
 * The static graph the components draw: a ready `Manifest` (`inspect(wizard)`, plain JSON — a
 * client can receive it from the server) or the wizard itself (`inspect` is called for you);
 * `graph` wins when both are given.
 * @public
 */
interface GraphInput {
  readonly graph?: Manifest;
  readonly wizard?: AnyWizardDefinition;
}
//#endregion
//#region src/devtools/use-resize.d.ts
/**
 * Where the `<Devtools>` panel docks.
 * @public
 */
type DockPosition = 'bottom' | 'right';
//#endregion
//#region src/devtools/Devtools.d.ts
/**
 * `<Devtools>` props: the `source` (a `Run` or a `Mirror`), the graph (`wizard` / `graph`; a
 * run source brings its own wizard), `theme`, `defaultOpen`, dock `position` and `defaultSize`
 * (px), the toggle `hotkey` (default `ctrl+shift+d`, `false` to disable), `context` (the input
 * `wizard.create` received) for a full-range timeline, `maxEvents` for the event buffer.
 * @public
 */
interface DevtoolsProps extends GraphInput {
  readonly source: DevtoolsSource;
  readonly theme?: DevtoolsTheme;
  readonly defaultOpen?: boolean;
  readonly position?: DockPosition;
  readonly defaultSize?: number;
  readonly hotkey?: string | false;
  readonly context?: unknown;
  readonly maxEvents?: number;
  readonly title?: string;
}
/**
 * The composite devtools panel: the wizard graph with the live overlay (and the time-travelled
 * state while the timeline scrubs), the event log, the step inspector and the timeline, in a
 * dockable, resizable panel. Works over a `Mirror` too (graph + inspector from the projected
 * state; the events and the timeline need a run and say so).
 * @public
 */
declare function Devtools(props: DevtoolsProps): ReactElement;
//#endregion
//#region src/layout/model.d.ts
/**
 * Kind of a drawable node: a step card, a group (a `child` step containing its child wizard), a
 * wizard's entry marker or the `?` port of a dynamic `next` without declared targets.
 * @public
 */
type ModelNodeKind = 'step' | 'group' | 'entry' | 'dynamic';
/**
 * Kind of a drawable edge: the `Manifest` kinds (`route` = a declared target of a dynamic
 * `next`) plus `dynamic` (a step → its `?` port when no targets are declared).
 * @public
 */
type ModelEdgeKind = ManifestEdge['kind'] | 'dynamic';
/**
 * One drawable node. `key` is unique across nesting levels (`stepKey(path, id)`, `#entry` /
 * `#dyn` suffixes for the markers); `parent` is the group key for nodes inside a child wizard.
 * @public
 */
interface ModelNode {
  readonly key: string;
  readonly kind: ModelNodeKind;
  /** The step this node stands for (absent for entry markers). */
  readonly step?: ManifestStep;
  readonly path: readonly string[];
  readonly parent?: string;
  readonly width: number;
  readonly height: number;
}
/**
 * One drawable edge between two model keys, with labels for routing, joins and alternate paths.
 * @public
 */
interface ModelEdge {
  readonly key: string;
  readonly source: string;
  readonly target: string;
  readonly kind: ModelEdgeKind;
  readonly label?: string;
  readonly path: readonly string[];
  /** The group both ends live in (absent at the root). */
  readonly parent?: string;
}
/**
 * The drawable model of a `Manifest`: nodes (parents before children), edges and the warnings
 * by step key. Built by `buildGraphModel`, positioned by `layoutGraph`.
 * @public
 */
interface GraphModel {
  readonly nodes: readonly ModelNode[];
  readonly edges: readonly ModelEdge[];
  /** Warnings by step key (`UNREACHABLE`, `NAV_CYCLE`, `EXCLUSIVE_JOIN`, `SKIPPED_NEED`). */
  readonly warnings: Readonly<Record<string, readonly string[]>>;
}
/**
 * Build the drawable model of a `Manifest` (`inspect(wizard)`): one entry marker per wizard, a card
 * per step — a `child` step whose child wizard is in the graph becomes a group containing it — a
 * `?` port per dynamic `next` without declared targets, and typed, labelled edges. Pure and
 * synchronous.
 * @public
 */
declare function buildGraphModel(graph: Manifest): GraphModel;
//#endregion
//#region src/layout/elk.d.ts
/**
 * Box of a laid-out node: absolute at the root, relative to its group inside a child wizard.
 * @public
 */
interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/**
 * Placements by model key.
 * @public
 */
type Placements = Readonly<Record<string, Placement>>;
/**
 * What runs the layout: anything with ELK's `layout(graph)` — the bundled elkjs (default), a
 * worker-backed ELK, a stub in tests.
 * @public
 */
interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}
/**
 * What `layoutGraph` returns: the placements, the edges left out of the layered layout (drawn
 * as U-turns) and the root nodes parked in the isolated column.
 * @public
 */
interface LayoutResult {
  readonly placements: Placements;
  /** Which way the layers run. */
  readonly direction: LayoutDirection;
  /** The routed line of every edge ELK laid out, by edge key. */
  readonly routes: Readonly<Record<string, EdgeRoute>>;
  /** Edges left out of the layered layout (drawn as U-turns / self-loops). */
  readonly backEdges: ReadonlySet<string>;
  /** Root nodes parked in the isolated column. */
  readonly isolated: ReadonlySet<string>;
}
/**
 * Which way the layers run: `right` puts the first step on the left, `down` puts it on top.
 * @public
 */
type LayoutDirection = 'right' | 'down';
/**
 * Options for `layoutGraph`.
 * @public
 */
interface LayoutOptions {
  /** Which way the layers run (default `right`). */
  readonly direction?: LayoutDirection;
}
/**
 * A point in flow coordinates (absolute, the same space as the root placements).
 * @public
 */
interface Point {
  readonly x: number;
  readonly y: number;
}
/**
 * The line ELK routed for an edge, in absolute flow coordinates: right-angled bends that keep
 * clear of the cards, and the centre of the edge's label when it has one.
 * @public
 */
interface EdgeRoute {
  readonly points: readonly Point[];
  readonly label?: Point;
}
/**
 * The bundled elkjs engine (no worker) — loaded once, lazily, so importing the package stays
 * cheap until a graph is drawn.
 * @public
 */
declare function bundledElk(): Promise<LayoutEngine>;
/**
 * Lay a graph model out with ELK (layered, `options.direction` right or down, right-angled edge
 * routes): back edges are removed first so the algorithm sees a DAG, groups are compound nodes,
 * root nodes no edge touches are parked after the rest. Resolves to a placement for every node
 * and a route for every edge ELK laid out.
 * @public
 */
declare function layoutGraph(model: GraphModel, engine?: LayoutEngine, options?: LayoutOptions): Promise<LayoutResult>;
//#endregion
//#region src/graph/direction.d.ts
/**
 * Which way the layers of `<WizardGraph>` run: `right`, `down`, or `auto` to pick the one that
 * draws the graph larger in its pane.
 * @public
 */
type GraphDirection = LayoutDirection | 'auto';
/**
 * Lets `<WizardGraph>` set its own height to fit the graph, between `min` and `max` pixels.
 * `true` means 120 to 480, never more than 70% of the window. A graph shorter than `max`
 * gets only the height it needs, down to `min`.
 * @public
 */
type GraphAutoHeight = boolean | {
  readonly min: number;
  readonly max: number;
};
//#endregion
//#region src/graph/WizardGraph.d.ts
/**
 * `<WizardGraph>` props: the graph (`graph` from `inspect(wizard)`, or `wizard`), the live overlay
 * (`statuses` keyed by `stepKey`, `activeStep` = the current view's key), a controlled or
 * uncontrolled selection (`selected` / `onSelect`), the theme and an optional layout engine.
 * @public
 */
interface WizardGraphProps extends GraphInput {
  /** Key of the current view (`stepKey(path, id)`) — highlighted. */
  readonly activeStep?: string | null;
  /** Live statuses / phases by step key (see `collectStatuses`). */
  readonly statuses?: StepStatusMap;
  /** Live child run paths from collectStatuses(). Mapped children get one group per index. */
  readonly childPaths?: readonly (readonly string[])[];
  /** Selected step key (controlled). Omit to let the graph keep its own selection. */
  readonly selected?: string | null;
  readonly onSelect?: (selection: GraphSelection | null) => void;
  readonly theme?: DevtoolsTheme;
  /** Custom ELK-compatible layout engine (a worker-backed ELK, a stub in tests). */
  readonly layoutEngine?: LayoutEngine;
  /**
   * Keep the graph readable: a graph too wide to read whole is drawn larger, centred on the
   * steps that are running, waiting or failed, and the view moves as the run does.
   */
  readonly follow?: boolean;
  /** Show the minimap (default `true`). */
  readonly minimap?: boolean;
  /**
   * Which way the layers run: `right` (first step on the left), `down` (first step on top), or
   * `auto` (default) to pick the one that draws the graph larger in its pane, so a narrow pane
   * gets a top-to-bottom graph.
   */
  readonly direction?: GraphDirection;
  /**
   * Let the graph set its own height to show the whole wizard at a readable size: `true` for
   * 200 to 480 pixels (at most 70% of the window), or `{ min, max }`. The width still comes
   * from the container. Omit it to fill the container's height.
   */
  readonly autoHeight?: GraphAutoHeight;
  /**
   * Keys (`stepKey(path, id)`) of the steps that wait on a person, such as a form to fill in or a
   * service call to answer by hand. Each of them shows `waiting on you` while it runs or waits,
   * and a ring when it is undoing, done or failed, since those keep their own word. When
   * omitted, a form step that waits for input shows `waiting on you` and every other waiting
   * step shows `waiting`.
   */
  readonly attention?: readonly string[];
  /**
   * The run has ended (done, failed, cancelled or undone). A step it never started then shows
   * `not run` instead of `blocked`. Default `false`.
   */
  readonly ended?: boolean;
  /**
   * The run's status (`run.status`, such as `running`, `compensating` or `failed`). While the
   * run is undoing, or once it has stopped, a step it never started shows `not run` instead of
   * `blocked`, as `ended` does. Omit it to rely on `ended` alone.
   */
  readonly runStatus?: string;
  /**
   * Show the small React Flow link in the corner (default `true`). Pass `false` only when you
   * credit React Flow elsewhere.
   */
  readonly attribution?: boolean;
  /**
   * Zoom with the mouse wheel (default `true`). Pass `false` for a graph inside a scrolling
   * page: the wheel then scrolls the page, and pinch or Ctrl with the wheel still zooms.
   */
  readonly wheelZoom?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * The static graph of a wizard, laid out with ELK (layers running right or down, picked for the
 * pane by default; cycles broken for the layout and drawn as U-turns; child wizards as group
 * nodes) with the live overlay when `statuses` / `activeStep` are given. Click a step, or focus
 * it and press Enter, to select it (`onSelect`); click the pane to clear.
 * @public
 */
declare function WizardGraph(props: WizardGraphProps): ReactElement;
//#endregion
//#region src/events/EventLog.d.ts
/**
 * `<EventLog>` props: a live `source` (run) or a static `events` array; an optional `filter`
 * (substring over type / step / event / path, or a predicate); `onSelect` + `selectedSeq` for
 * the row selection; `maxRows` bounds the live buffer (default 2000).
 * @public
 */
interface EventLogProps {
  readonly source?: RunSource;
  readonly events?: readonly RunEvent[];
  readonly filter?: string | ((event: RunEvent) => boolean);
  readonly onSelect?: (event: RunEvent) => void;
  readonly selectedSeq?: number | null;
  readonly maxRows?: number;
  /** Show the filter box (default `true`). */
  readonly showFilter?: boolean;
  readonly theme?: DevtoolsTheme;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * The event log of a run: `seq`, `at`, `type`, `step`, `path` and a one-line detail per event.
 * Live over `source.observe()` (starting from `source.log()`), or the given `events`. Click a
 * row to select it (`onSelect(event)`).
 * @public
 */
declare function EventLog(props: EventLogProps): ReactElement;
//#endregion
//#region src/inspector/StepInspector.d.ts
/**
 * `<StepInspector>` props: the `source` (run or Mirror), the `step` id and the run `path`
 * of its wizard (`[]` = root), the optional static `graph` for the definition facts.
 * @public
 */
interface StepInspectorProps {
  readonly source: DevtoolsSource;
  readonly step: string;
  readonly path?: readonly string[];
  readonly graph?: Manifest;
  readonly theme?: DevtoolsTheme;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * The record of a step (status, attempt, error, input / output), why it is where it is
 * (`explain`: reasons + candidates — run sources only) and its definition facts.
 * @public
 */
declare function StepInspector(props: StepInspectorProps): ReactElement;
//#endregion
//#region src/timeline/replay-window.d.ts
/**
 * A (typed-erased) run state as `replay` returns it.
 * @public
 */
type ReplayState = Snapshot<AnyWizardDefinition>['state'];
/**
 * The replay window: a base state and the root events since it (`latest` = the newest seq).
 * @public
 */
interface ReplayWindow {
  /** The state every replay starts from (its `seq` is the earliest scrubbable point). */
  readonly base: ReplayState;
  /** Root events with `seq > base.seq`, ascending. */
  readonly events: readonly RunEvent[];
  /** The latest seq (`events` last, else `base.seq`). */
  readonly latest: number;
}
/**
 * A live replay window over a run (`createReplayWindow`): subscribe to it, `attach()` it to
 * start following the run, read `window`.
 * @public
 */
interface ReplayWindowStore {
  readonly window: ReplayWindow;
  subscribe(listener: () => void): () => void;
  /** Seed from the run now and start following it; returns the teardown. */
  attach(): () => void;
}
/**
 * Create the replay window of a run: the base is the run's state when `attach()` runs (or
 * the initial state built from `options.context` when the log still starts at seq 1); root
 * events are appended from `observe()`; past `maxEvents` (default 5000) the oldest half is
 * folded into the base. `<Timeline>` creates one itself; `<Devtools>` owns one so the range
 * survives closing the panel.
 * @public
 */
declare function createReplayWindow(run: RunSource, options?: {
  readonly maxEvents?: number;
  readonly context?: unknown;
}): ReplayWindowStore;
//#endregion
//#region src/timeline/Timeline.d.ts
/**
 * `<Timeline>` props: the run `source`; `context` (the input `wizard.create` received) lets the
 * window start from the initial state when the whole log is still available, else scrubbing
 * starts where the timeline attached; `onScrub` receives the replayed state (or `null` when
 * following the live end); `maxEvents` bounds the window (default 5000).
 * @public
 */
interface TimelineProps {
  readonly source: RunSource;
  readonly context?: unknown;
  readonly onScrub?: (state: ReplayState | null, seq: number) => void;
  readonly maxEvents?: number;
  /** A shared window (`createReplayWindow`, attached by its owner) — the `<Devtools>` panel passes its own so the range survives closing the panel. */
  readonly store?: ReplayWindowStore;
  readonly theme?: DevtoolsTheme;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * Time travel over a run's events: a `seq` slider (and ◀ / ▶ buttons) shows the state at any
 * kept seq — status, current view, active steps, every step's status — and the event that
 * produced it; "live" snaps back to the newest state. Read-only; the range is bounded by what
 * the timeline saw (`log()` at attach time + `observe()` since) and by `maxEvents`.
 * @public
 */
declare function Timeline(props: TimelineProps): ReactElement;
//#endregion
//#region src/status.d.ts
/**
 * Flatten a run snapshot (`getSnapshot()`: state + children, recursively) or a projected
 * `ClientState` (its `steps`, recursing into `child` slices that are projected states) into a
 * `StepStatusMap`, and report the key of the current view (the deepest cursor) and live
 * `childPaths` for the graph. Mapped children use `[owner, String(index)]`. Phases come
 * from the projected state when it has them; for a run snapshot pass `phaseOf` (typically
 * `(path, id) => run.explain(id).phase` scoped to the child) to add them.
 * @public
 */
declare function collectStatuses(state: SnapshotLike | ProjectedState, phaseOf?: (path: readonly string[], id: string) => StepPhase | undefined): {
  readonly statuses: StepStatusMap;
  readonly current: string | null;
  readonly childPaths: readonly (readonly string[])[];
};
/**
 * The phase reader for a live run: `explain(id).phase` on the run for root steps and on
 * the live child handle for nested ones (a child that is not live has no phase).
 * @public
 */
declare function runPhaseReader(run: RunSource): (path: readonly string[], id: string) => StepPhase | undefined;
/**
 * The live overlay of a source for one of its snapshots (`source.getSnapshot()`): statuses (with
 * phases) and the current view key — the run snapshot + `explain` for a run, the projected
 * state for a Mirror (a `select` projection that is not `ClientState`-shaped yields an empty map).
 * @public
 */
declare function overlayOf(source: DevtoolsSource, snapshot: unknown): {
  readonly statuses: StepStatusMap;
  readonly current: string | null;
  readonly childPaths: readonly (readonly string[])[];
};
//#endregion
export { Devtools, type DevtoolsProps, type DevtoolsSource, type DevtoolsTheme, type DockPosition, type EdgeRoute, EventLog, type EventLogProps, type GraphAutoHeight, type GraphDirection, type GraphInput, type GraphModel, type GraphSelection, type LayoutDirection, type LayoutEngine, type LayoutOptions, type LayoutResult, type MirrorSource, type ModelEdge, type ModelEdgeKind, type ModelNode, type ModelNodeKind, type Placement, type Placements, type Point, type ProjectedState, type ProjectedStep, type ReplayState, type ReplayWindow, type ReplayWindowStore, type RunSource, type SnapshotLike, StepInspector, type StepInspectorProps, type StepPhase, type StepStatusInfo, type StepStatusMap, Timeline, type TimelineProps, WizardGraph, type WizardGraphProps, buildGraphModel, bundledElk, collectStatuses, createReplayWindow, isProjectedState, isRunSource, layoutGraph, overlayOf, runPhaseReader, stepKey };
//# sourceMappingURL=index.d.ts.map