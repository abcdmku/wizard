# @openwizard/devtools

React devtools for [OpenWizard](../../README.md). You get four components, the flow graph with a
live status overlay, an event log, a step inspector and a replay timeline, and a dockable
`<Devtools>` panel that puts all four over a `Wizard` or a `Mirror`.

```sh
pnpm add -D @openwizard/devtools   # brings @xyflow/react + elkjs; peers: react / react-dom ^18 || ^19, @openwizard/core
```

```tsx
import { Devtools } from '@openwizard/devtools'
import '@openwizard/devtools/style.css' // once; bundles React Flow's stylesheet + the --owd-* theme

function App({ wizard }: { wizard: Wizard<typeof pipeline> }) {
  return (
    <>
      <MyApp wizard={wizard} />
      <Devtools source={wizard} context={{ source: 'crm-export' }} defaultOpen />
    </>
  )
}
```

`ctrl+shift+d` toggles the panel, you drag its edge to resize, and it docks at the bottom or on
the right. [`examples/10-devtools`](../../examples/10-devtools) is a Vite app running example
07's DAG under the panel.

## Components

| Component | Needs | Shows |
|---|---|---|
| `<FlowGraph graph statuses? activeStep? selected? onSelect? theme? layoutEngine? minimap? />` | nothing, it's static | the graph from `inspect(flow)`, laid out by ELK |
| `<EventLog source events? filter? onSelect? selectedSeq? maxRows? />` | a wizard | the domain events, live or from an array |
| `<StepInspector source step path? graph? />` | a wizard or a Mirror | everything known about one step |
| `<Timeline source context? onScrub? maxEvents? />` | a wizard | the state at any past `seq` |
| `<Devtools source theme? defaultOpen? position? defaultSize? hotkey? context? flow? graph? />` | a wizard or a Mirror | the four above as tabs in a fixed panel |

Every component takes `theme?: 'light' | 'dark' | 'system'`, defaulting to `system`. It sets
`data-theme` on its root, and every colour is a `--owd-*` CSS variable you can override.

### FlowGraph

ELK lays the steps out left to right in layers, one card per step showing its id, kind, `start`,
hook / `dependsOn` / `timeout` flags and a warnings badge. Edges are solid for `next`, dashed and
labelled for `dependsOn`, dotted and labelled for `timeout`, and a dashed line to a `?` port for a
dynamic `next`; child flows become group nodes holding their own graph. Cycles are broken for the
layout and drawn as U-turns or self-loops, and steps no edge touches park in a right-hand column.
Pass a `StepStatusMap` as `statuses` and each card gets a status ring with a pulsing phase dot,
`activeStep` highlights the current view, and clicking a card calls `onSelect({ id, path, key })`.

### EventLog

Rows carry `seq`, `at`, `type`, `step`, `path` and the detail, either live through `observe()`
seeded from `log()` and including child events, or from a static array you pass. The filter box
matches a substring against type, step, event and path, or you can hand it your own predicate.
Only the visible rows are in the DOM, and it follows the newest row until you scroll up.

### StepInspector

You get the stored record (status, attempt, run / retry / deadline facts, `error`, `issues`,
`input` and `output` as JSON), the answer from `wizard.explain(step)` with its reasons and cursor
candidates, and the definition facts from the graph. A Mirror source says it needs a wizard for
the `explain` part.

### Timeline

A `seq` slider walks the replay window and shows the state at any kept seq through
`replay(flow, events, { from, upTo })`, which is read-only and runs no hooks. The range starts
where the timeline attached, so mount it before `start()`, or pass the `context` that
`createWizard` received while `log()` still starts at seq 1, and you get the whole history. Past
`maxEvents`, which defaults to 5000, the oldest half folds into the base.

### Devtools

The panel's graph overlay follows the source live and switches to the time-travelled state while
the timeline scrubs, and clicking an event or a card selects that step for the inspector. The
buffers live in the panel, so closing it loses nothing.

## Sources

The components are typed structurally, so any `Wizard<F>` is a `WizardSource` (`flow`,
`getState`, `getSnapshot`, `subscribe`, `observe`, `log`, `explain`, `child`) and any `Mirror<P>`
is a `MirrorSource` (`getSnapshot`, `subscribe`, `instanceId`, `epoch`, `seq`, `connected`).
Over a Mirror the panel still draws the graph if you give it `flow` or `graph`, since
`inspect(flow)` is plain JSON your server can send, and it reads the overlay out of the projected
`ClientState`. The event log, `explain()` and the timeline all need a wizard, and they say so
when they don't have one.

## Overlay helpers

`stepKey(path, id)` names a step across nesting levels, like `'fulfil/pick'`.
`collectStatuses(snapshotOrClientState, phaseOf?)` flattens a wizard snapshot or a projected
state into a `StepStatusMap` plus the current view key, and `overlayOf(source, source.getSnapshot())`
does that for either kind of source. `buildGraphModel(graph)` and `layoutGraph(model, engine?)`
are the pure halves of the graph, and a custom `LayoutEngine`, meaning anything shaped like
`{ layout(elkGraph) }`, replaces the bundled elkjs in a worker or in tests.

## Bundle

`@xyflow/react`, `elkjs` and React are externals, so the host bundles them, and elkjs only loads
the first time a graph is drawn. `dist/style.css` is React Flow's stylesheet plus the `--owd-*`
theme.

## Exports

<!-- exports:start -->

<!-- generated by scripts/gen-export-tables.mjs — do not edit by hand -->

| Export | Kind | Summary | Source |
|---|---|---|---|
| `buildGraphModel` | function | Build the drawable model of a `FlowGraph` (`inspect(flow)`): one entry marker per flow, a card | [src](../../packages/devtools/src/layout/model.ts#L93) |
| `bundledElk` | function | The bundled elkjs engine (no worker) — loaded once, lazily, so importing the package stays | [src](../../packages/devtools/src/layout/elk.ts#L84) |
| `collectStatuses` | function | Flatten a wizard snapshot (`getSnapshot()`: state + children, recursively) or a projected | [src](../../packages/devtools/src/status.ts#L36) |
| `createReplayWindow` | function | Create the replay window of a wizard: the base is the wizard's state when `attach()` runs (or | [src](../../packages/devtools/src/timeline/replay-window.ts#L61) |
| `Devtools` | function | The composite devtools panel: the flow graph with the live overlay (and the time-travelled | [src](../../packages/devtools/src/devtools/Devtools.tsx#L59) |
| `DevtoolsProps` | interface | `<Devtools>` props: the `source` (a `Wizard` or a `Mirror`), the graph (`flow` / `graph`; a | [src](../../packages/devtools/src/devtools/Devtools.tsx#L32) |
| `DevtoolsSource` | type | What the components accept as `source`: a live `Wizard` or a `Mirror`. | [src](../../packages/devtools/src/types.ts#L120) |
| `DevtoolsTheme` | type | Colour scheme of the devtools: `'system'` follows `prefers-color-scheme`, the others force it | [src](../../packages/devtools/src/types.ts#L25) |
| `DockPosition` | type | Where the `<Devtools>` panel docks. | [src](../../packages/devtools/src/devtools/use-resize.ts#L12) |
| `EventLog` | function | The event log of a wizard: `seq`, `at`, `type`, `step`, `path` and a one-line detail per event. | [src](../../packages/devtools/src/events/EventLog.tsx#L53) |
| `EventLogProps` | interface | `<EventLog>` props: a live `source` (wizard) or a static `events` array; an optional `filter` | [src](../../packages/devtools/src/events/EventLog.tsx#L29) |
| `FlowGraph` | function | The static graph of a flow, laid out with ELK (left → right layers; cycles broken for the | [src](../../packages/devtools/src/graph/FlowGraph.tsx#L80) |
| `FlowGraphEdge` | type | One edge of a `FlowGraph` (`inspect(flow).edges[i]`): `from` (`null` for `start`), `to`, kind, path. | [src](../../packages/devtools/src/types.ts#L198) |
| `FlowGraphNode` | type | One node of a `FlowGraph` (`inspect(flow).nodes[i]`): id, kind, path, hooks, `dependsOn`, | [src](../../packages/devtools/src/types.ts#L192) |
| `FlowGraphProps` | interface | `<FlowGraph>` props: the graph (`graph` from `inspect(flow)`, or `flow`), the live overlay | [src](../../packages/devtools/src/graph/FlowGraph.tsx#L48) |
| `GraphInput` | interface | The static graph the components draw: a ready `FlowGraph` (`inspect(flow)`, plain JSON — a | [src](../../packages/devtools/src/types.ts#L182) |
| `GraphModel` | interface | The drawable model of a `FlowGraph`: nodes (parents before children), edges and the warnings | [src](../../packages/devtools/src/layout/model.ts#L70) |
| `GraphSelection` | interface | What a graph click reports: the step `id`, the wizard `path` of its flow and the combined | [src](../../packages/devtools/src/types.ts#L56) |
| `isProjectedState` | function | True when a Mirror's projected value looks like a `ClientState` (an `expose` projection): | [src](../../packages/devtools/src/types.ts#L170) |
| `isWizardSource` | function | True for a `WizardSource` (it has `observe` / `log` / `explain`); false for a Mirror. | [src](../../packages/devtools/src/types.ts#L126) |
| `LayoutEngine` | interface | What runs the layout: anything with ELK's `layout(graph)` — the bundled elkjs (default), a | [src](../../packages/devtools/src/layout/elk.ts#L37) |
| `layoutGraph` | function | Lay a graph model out with ELK (layered, left → right, 150 px between layers, splines, network | [src](../../packages/devtools/src/layout/elk.ts#L99) |
| `LayoutResult` | interface | What `layoutGraph` returns: the placements, the edges left out of the layered layout (drawn | [src](../../packages/devtools/src/layout/elk.ts#L46) |
| `MirrorSource` | interface | The structural view of a `Mirror` the devtools read (`Mirror<P>` of any projection satisfies | [src](../../packages/devtools/src/types.ts#L107) |
| `ModelEdge` | interface | One drawable edge between two model keys (`label` for `dependsOn` / `timeout` edges). | [src](../../packages/devtools/src/layout/model.ts#L54) |
| `ModelEdgeKind` | type | Kind of a drawable edge: the `FlowGraph` kinds plus `dynamic` (a step → its `?` port). | [src](../../packages/devtools/src/layout/model.ts#L32) |
| `ModelNode` | interface | One drawable node. `key` is unique across nesting levels (`stepKey(path, id)`, `#entry` / | [src](../../packages/devtools/src/layout/model.ts#L39) |
| `ModelNodeKind` | type | Kind of a drawable node: a step card, a group (a `flow` step containing its child flow), a | [src](../../packages/devtools/src/layout/model.ts#L26) |
| `overlayOf` | function | The live overlay of a source for one of its snapshots (`source.getSnapshot()`): statuses (with | [src](../../packages/devtools/src/status.ts#L107) |
| `Placement` | interface | Box of a laid-out node: absolute at the root, relative to its group inside a child flow. | [src](../../packages/devtools/src/layout/elk.ts#L19) |
| `Placements` | type | Placements by model key. | [src](../../packages/devtools/src/layout/elk.ts#L30) |
| `ProjectedState` | interface | A projected (`ClientState`) state as the devtools read it: `status`, `current`, the exposed | [src](../../packages/devtools/src/types.ts#L154) |
| `ProjectedStep` | interface | The projected step facts a `ClientState` carries for every step (`ClientStepState` base) plus | [src](../../packages/devtools/src/types.ts#L135) |
| `ReplayState` | type | A (typed-erased) wizard state as `replay` returns it. | [src](../../packages/devtools/src/timeline/replay-window.ts#L18) |
| `ReplayWindow` | interface | The replay window: a base state and the root events since it (`latest` = the newest seq). | [src](../../packages/devtools/src/timeline/replay-window.ts#L24) |
| `ReplayWindowStore` | interface | A live replay window over a wizard (`createReplayWindow`): subscribe to it, `attach()` it to | [src](../../packages/devtools/src/timeline/replay-window.ts#L38) |
| `SnapshotLike` | interface | A wizard snapshot as the devtools walk it: the (typed-erased) state plus the live children by | [src](../../packages/devtools/src/types.ts#L76) |
| `StepInspector` | function | The record of a step (status, attempt, error, input / output), why it is where it is | [src](../../packages/devtools/src/inspector/StepInspector.tsx#L57) |
| `StepInspectorProps` | interface | `<StepInspector>` props: the `source` (wizard or Mirror), the `step` id and the wizard `path` | [src](../../packages/devtools/src/inspector/StepInspector.tsx#L26) |
| `stepKey` | function | The key of a step in a `StepStatusMap` / graph selection: `[...path, id].join('/')` — the bare | [src](../../packages/devtools/src/types.ts#L67) |
| `StepPhase` | type | Live phase of a step as `wizard.explain(step).phase` / `ClientStepState.phase` report it | [src](../../packages/devtools/src/types.ts#L32) |
| `StepStatusInfo` | interface | Live facts of one step for the graph overlay: its stored `status` and, when known, its `phase`. | [src](../../packages/devtools/src/types.ts#L38) |
| `StepStatusMap` | type | Statuses keyed by step key (`stepKey(path, id)`: the step id for the root flow, | [src](../../packages/devtools/src/types.ts#L49) |
| `Timeline` | function | Time travel over a wizard's events: a `seq` slider (and ◀ / ▶ buttons) shows the state at any | [src](../../packages/devtools/src/timeline/Timeline.tsx#L52) |
| `TimelineProps` | interface | `<Timeline>` props: the wizard `source`; `context` (the input `createWizard` received) lets the | [src](../../packages/devtools/src/timeline/Timeline.tsx#L33) |
| `wizardPhaseReader` | function | The phase reader for a live wizard: `explain(id).phase` on the wizard for root steps and on | [src](../../packages/devtools/src/status.ts#L85) |
| `WizardSource` | interface | The structural view of a `Wizard` the devtools read (`Wizard<F>` of any flow satisfies it): | [src](../../packages/devtools/src/types.ts#L87) |

<!-- exports:end -->
