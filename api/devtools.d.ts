import { AnyFlow, Explanation, FlowGraph as FlowGraph$1, Snapshot, StepKind, StepStatus, WizardEvent } from "@openwizard/core";
import { CSSProperties, ReactElement } from "react";
import { ElkNode } from "elkjs/lib/elk-api";
//#region src/types.d.ts
/**
 * Colour scheme of the devtools: `'system'` follows `prefers-color-scheme`, the others force it
 * (`data-theme` on the root element; every colour is a `--owd-*` CSS variable).
 * @public
 */
type DevtoolsTheme = 'light' | 'dark' | 'system';
/**
 * Live phase of a step as `wizard.explain(step).phase` / `ClientStepState.phase` report it
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
}
/**
 * Statuses keyed by step key (`stepKey(path, id)`: the step id for the root flow,
 * `'fulfil/pick'` for step `pick` of the child flow of `fulfil`). Built with
 * `collectStatuses()` from a wizard snapshot or a projected (`ClientState`) state, or by hand.
 * @public
 */
type StepStatusMap = Readonly<Record<string, StepStatusInfo>>;
/**
 * What a graph click reports: the step `id`, the wizard `path` of its flow and the combined
 * `key` (`stepKey(path, id)`).
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
 * A wizard snapshot as the devtools walk it: the (typed-erased) state plus the live children by
 * flow-step id. `Wizard.getSnapshot()` of any flow returns one.
 * @public
 */
interface SnapshotLike {
  readonly state: Snapshot<AnyFlow>['state'];
  readonly children: Readonly<Record<string, SnapshotLike | undefined>>;
}
/**
 * The structural view of a `Wizard` the devtools read (`Wizard<F>` of any flow satisfies it):
 * identity, the flow, state / snapshot, the two subscriptions, the bounded log, `explain` and
 * the live child handles.
 * @public
 */
interface WizardSource {
  readonly id: string;
  readonly flow: AnyFlow;
  getState(): Snapshot<AnyFlow>['state'];
  getSnapshot(): SnapshotLike;
  subscribe(listener: () => void): () => void;
  observe(listener: (event: WizardEvent) => void): () => void;
  log(): readonly WizardEvent[];
  explain(step: string): Explanation;
  /** Live child of an active flow step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE` otherwise). */
  child(step: string): WizardSource;
}
/**
 * The structural view of a `Mirror` the devtools read (`Mirror<P>` of any projection satisfies
 * it): the projected state (`null` before the first frame), its subscription and the frame
 * identity. Events, `explain` and the timeline need a wizard; a Mirror source shows the graph
 * (with `flow` / `graph`) and the projected step facts.
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
 * What the components accept as `source`: a live `Wizard` or a `Mirror`.
 * @public
 */
type DevtoolsSource = WizardSource | MirrorSource;
/**
 * True for a `WizardSource` (it has `observe` / `log` / `explain`); false for a Mirror.
 * @public
 */
declare function isWizardSource(source: DevtoolsSource): source is WizardSource;
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
 * The static graph the components draw: a ready `FlowGraph` (`inspect(flow)`, plain JSON — a
 * client can receive it from the server) or the flow itself (`inspect` is called for you);
 * `graph` wins when both are given.
 * @public
 */
interface GraphInput {
  readonly graph?: FlowGraph$1;
  readonly flow?: AnyFlow;
}
/**
 * One node of a `FlowGraph` (`inspect(flow).nodes[i]`): id, kind, path, hooks, `dependsOn`,
 * `timeout`, `dynamicNext`, `start`.
 * @public
 */
type FlowGraphNode = FlowGraph$1['nodes'][number];
/**
 * One edge of a `FlowGraph` (`inspect(flow).edges[i]`): `from` (`null` for `start`), `to`, kind, path.
 * @public
 */
type FlowGraphEdge = FlowGraph$1['edges'][number];
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
 * `<Devtools>` props: the `source` (a `Wizard` or a `Mirror`), the graph (`flow` / `graph`; a
 * wizard source brings its own flow), `theme`, `defaultOpen`, dock `position` and `defaultSize`
 * (px), the toggle `hotkey` (default `ctrl+shift+d`, `false` to disable), `context` (the input
 * `createWizard` received) for a full-range timeline, `maxEvents` for the event buffer.
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
 * The composite devtools panel: the flow graph with the live overlay (and the time-travelled
 * state while the timeline scrubs), the event log, the step inspector and the timeline, in a
 * dockable, resizable panel. Works over a `Mirror` too (graph + inspector from the projected
 * state; the events and the timeline need a wizard and say so).
 * @public
 */
declare function Devtools(props: DevtoolsProps): ReactElement;
//#endregion
//#region src/layout/model.d.ts
/**
 * Kind of a drawable node: a step card, a group (a `flow` step containing its child flow), a
 * flow's entry marker or the `?` port of a dynamic `next`.
 * @public
 */
type ModelNodeKind = 'step' | 'group' | 'entry' | 'dynamic';
/**
 * Kind of a drawable edge: the `FlowGraph` kinds plus `dynamic` (a step → its `?` port).
 * @public
 */
type ModelEdgeKind = FlowGraphEdge['kind'] | 'dynamic';
/**
 * One drawable node. `key` is unique across nesting levels (`stepKey(path, id)`, `#entry` /
 * `#dyn` suffixes for the markers); `parent` is the group key for nodes inside a child flow.
 * @public
 */
interface ModelNode {
  readonly key: string;
  readonly kind: ModelNodeKind;
  /** The step this node stands for (absent for entry markers). */
  readonly step?: FlowGraphNode;
  readonly path: readonly string[];
  readonly parent?: string;
  readonly width: number;
  readonly height: number;
}
/**
 * One drawable edge between two model keys (`label` for `dependsOn` / `timeout` edges).
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
 * The drawable model of a `FlowGraph`: nodes (parents before children), edges and the warnings
 * by step key. Built by `buildGraphModel`, positioned by `layoutGraph`.
 * @public
 */
interface GraphModel {
  readonly nodes: readonly ModelNode[];
  readonly edges: readonly ModelEdge[];
  /** Warnings by step key (`UNREACHABLE`, `NEVER_ACTIVATES`, `NAV_CYCLE`). */
  readonly warnings: Readonly<Record<string, readonly string[]>>;
}
/**
 * Build the drawable model of a `FlowGraph` (`inspect(flow)`): one entry marker per flow, a card
 * per step — a `flow` step whose child flow is in the graph becomes a group containing it — a
 * `?` port per dynamic `next`, and typed, labelled edges. Pure and synchronous.
 * @public
 */
declare function buildGraphModel(graph: FlowGraph$1): GraphModel;
//#endregion
//#region src/layout/elk.d.ts
/**
 * Box of a laid-out node: absolute at the root, relative to its group inside a child flow.
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
  /** Edges left out of the layered layout (drawn as U-turns / self-loops). */
  readonly backEdges: ReadonlySet<string>;
  /** Root nodes parked in the isolated column. */
  readonly isolated: ReadonlySet<string>;
}
/**
 * The bundled elkjs engine (no worker) — loaded once, lazily, so importing the package stays
 * cheap until a graph is drawn.
 * @public
 */
declare function bundledElk(): Promise<LayoutEngine>;
/**
 * Lay a graph model out with ELK (layered, left → right, 150 px between layers, splines, network
 * simplex): back edges are removed first so the algorithm sees a DAG, groups are compound nodes,
 * root nodes no edge touches are parked in a right-hand column. Resolves to a placement for
 * every node.
 * @public
 */
declare function layoutGraph(model: GraphModel, engine?: LayoutEngine): Promise<LayoutResult>;
//#endregion
//#region src/graph/FlowGraph.d.ts
/**
 * `<FlowGraph>` props: the graph (`graph` from `inspect(flow)`, or `flow`), the live overlay
 * (`statuses` keyed by `stepKey`, `activeStep` = the current view's key), a controlled or
 * uncontrolled selection (`selected` / `onSelect`), the theme and an optional layout engine.
 * @public
 */
interface FlowGraphProps extends GraphInput {
  /** Key of the current view (`stepKey(path, id)`) — highlighted. */
  readonly activeStep?: string | null;
  /** Live statuses / phases by step key (see `collectStatuses`). */
  readonly statuses?: StepStatusMap;
  /** Selected step key (controlled). Omit to let the graph keep its own selection. */
  readonly selected?: string | null;
  readonly onSelect?: (selection: GraphSelection | null) => void;
  readonly theme?: DevtoolsTheme;
  /** Custom ELK-compatible layout engine (a worker-backed ELK, a stub in tests). */
  readonly layoutEngine?: LayoutEngine;
  /** Show the minimap (default `true`). */
  readonly minimap?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * The static graph of a flow, laid out with ELK (left → right layers; cycles broken for the
 * layout and drawn as U-turns; nodes no edge touches parked in a right-hand column; child flows
 * as group nodes) with the live overlay when `statuses` / `activeStep` are given. Click a step
 * to select it (`onSelect`), the pane to clear.
 * @public
 */
declare function FlowGraph(props: FlowGraphProps): ReactElement;
//#endregion
//#region src/events/EventLog.d.ts
/**
 * `<EventLog>` props: a live `source` (wizard) or a static `events` array; an optional `filter`
 * (substring over type / step / event / path, or a predicate); `onSelect` + `selectedSeq` for
 * the row selection; `maxRows` bounds the live buffer (default 2000).
 * @public
 */
interface EventLogProps {
  readonly source?: WizardSource;
  readonly events?: readonly WizardEvent[];
  readonly filter?: string | ((event: WizardEvent) => boolean);
  readonly onSelect?: (event: WizardEvent) => void;
  readonly selectedSeq?: number | null;
  readonly maxRows?: number;
  /** Show the filter box (default `true`). */
  readonly showFilter?: boolean;
  readonly theme?: DevtoolsTheme;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * The event log of a wizard: `seq`, `at`, `type`, `step`, `path` and a one-line detail per event.
 * Live over `source.observe()` (starting from `source.log()`), or the given `events`. Click a
 * row to select it (`onSelect(event)`).
 * @public
 */
declare function EventLog(props: EventLogProps): ReactElement;
//#endregion
//#region src/inspector/StepInspector.d.ts
/**
 * `<StepInspector>` props: the `source` (wizard or Mirror), the `step` id and the wizard `path`
 * of its flow (`[]` = root), the optional static `graph` for the definition facts.
 * @public
 */
interface StepInspectorProps {
  readonly source: DevtoolsSource;
  readonly step: string;
  readonly path?: readonly string[];
  readonly graph?: FlowGraph$1;
  readonly theme?: DevtoolsTheme;
  readonly className?: string;
  readonly style?: CSSProperties;
}
/**
 * The record of a step (status, attempt, error, input / output), why it is where it is
 * (`explain`: reasons + candidates — wizard sources only) and its definition facts.
 * @public
 */
declare function StepInspector(props: StepInspectorProps): ReactElement;
//#endregion
//#region src/timeline/replay-window.d.ts
/**
 * A (typed-erased) wizard state as `replay` returns it.
 * @public
 */
type ReplayState = Snapshot<AnyFlow>['state'];
/**
 * The replay window: a base state and the root events since it (`latest` = the newest seq).
 * @public
 */
interface ReplayWindow {
  /** The state every replay starts from (its `seq` is the earliest scrubbable point). */
  readonly base: ReplayState;
  /** Root events with `seq > base.seq`, ascending. */
  readonly events: readonly WizardEvent[];
  /** The latest seq (`events` last, else `base.seq`). */
  readonly latest: number;
}
/**
 * A live replay window over a wizard (`createReplayWindow`): subscribe to it, `attach()` it to
 * start following the wizard, read `window`.
 * @public
 */
interface ReplayWindowStore {
  readonly window: ReplayWindow;
  subscribe(listener: () => void): () => void;
  /** Seed from the wizard now and start following it; returns the teardown. */
  attach(): () => void;
}
/**
 * Create the replay window of a wizard: the base is the wizard's state when `attach()` runs (or
 * the initial state built from `options.context` when the log still starts at seq 1); root
 * events are appended from `observe()`; past `maxEvents` (default 5000) the oldest half is
 * folded into the base. `<Timeline>` creates one itself; `<Devtools>` owns one so the range
 * survives closing the panel.
 * @public
 */
declare function createReplayWindow(wizard: WizardSource, options?: {
  readonly maxEvents?: number;
  readonly context?: unknown;
}): ReplayWindowStore;
//#endregion
//#region src/timeline/Timeline.d.ts
/**
 * `<Timeline>` props: the wizard `source`; `context` (the input `createWizard` received) lets the
 * window start from the initial state when the whole log is still available, else scrubbing
 * starts where the timeline attached; `onScrub` receives the replayed state (or `null` when
 * following the live end); `maxEvents` bounds the window (default 5000).
 * @public
 */
interface TimelineProps {
  readonly source: WizardSource;
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
 * Time travel over a wizard's events: a `seq` slider (and ◀ / ▶ buttons) shows the state at any
 * kept seq — status, current view, active steps, every step's status — and the event that
 * produced it; "live" snaps back to the newest state. Read-only; the range is bounded by what
 * the timeline saw (`log()` at attach time + `observe()` since) and by `maxEvents`.
 * @public
 */
declare function Timeline(props: TimelineProps): ReactElement;
//#endregion
//#region src/status.d.ts
/**
 * Flatten a wizard snapshot (`getSnapshot()`: state + children, recursively) or a projected
 * `ClientState` (its `steps`, recursing into `child` slices that are projected states) into a
 * `StepStatusMap`, and report the key of the current view (the deepest cursor). Phases come
 * from the projected state when it has them; for a wizard snapshot pass `phaseOf` (typically
 * `(path, id) => wizard.explain(id).phase` scoped to the child) to add them.
 * @public
 */
declare function collectStatuses(state: SnapshotLike | ProjectedState, phaseOf?: (path: readonly string[], id: string) => StepPhase | undefined): {
  readonly statuses: StepStatusMap;
  readonly current: string | null;
};
/**
 * The phase reader for a live wizard: `explain(id).phase` on the wizard for root steps and on
 * the live child handle for nested ones (a child that is not live has no phase).
 * @public
 */
declare function wizardPhaseReader(wizard: WizardSource): (path: readonly string[], id: string) => StepPhase | undefined;
/**
 * The live overlay of a source for one of its snapshots (`source.getSnapshot()`): statuses (with
 * phases) and the current view key — the wizard snapshot + `explain` for a wizard, the projected
 * state for a Mirror (a `select` projection that is not `ClientState`-shaped yields an empty map).
 * @public
 */
declare function overlayOf(source: DevtoolsSource, snapshot: unknown): {
  readonly statuses: StepStatusMap;
  readonly current: string | null;
};
//#endregion
export { Devtools, type DevtoolsProps, type DevtoolsSource, type DevtoolsTheme, type DockPosition, EventLog, type EventLogProps, FlowGraph, type FlowGraphEdge, type FlowGraphNode, type FlowGraphProps, type GraphInput, type GraphModel, type GraphSelection, type LayoutEngine, type LayoutResult, type MirrorSource, type ModelEdge, type ModelEdgeKind, type ModelNode, type ModelNodeKind, type Placement, type Placements, type ProjectedState, type ProjectedStep, type ReplayState, type ReplayWindow, type ReplayWindowStore, type SnapshotLike, StepInspector, type StepInspectorProps, type StepPhase, type StepStatusInfo, type StepStatusMap, Timeline, type TimelineProps, type WizardSource, buildGraphModel, bundledElk, collectStatuses, createReplayWindow, isProjectedState, isWizardSource, layoutGraph, overlayOf, stepKey, wizardPhaseReader };
//# sourceMappingURL=index.d.ts.map