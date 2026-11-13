/**
 * @openwizard/devtools — React devtools for OpenWizard: `<WizardGraph>` (React Flow + ELK graph
 * of `inspect(wizard)` with a live status overlay), `<EventLog>`, `<StepInspector>`, `<Timeline>`
 * (time travel with `replay`) and the dockable `<Devtools>` panel that composes them over a
 * `Run` or a `Mirror`. Import `@openwizard/devtools/style.css` once for the styles.
 *
 * @packageDocumentation
 */

// biome-ignore assist/source/organizeImports: hand-grouped by concept
export { Devtools, type DevtoolsProps } from './devtools/Devtools'
export type { DockPosition } from './devtools/use-resize'
export { WizardGraph, type WizardGraphProps } from './graph/WizardGraph'
export type { GraphAutoHeight, GraphDirection } from './graph/direction'
export { EventLog, type EventLogProps } from './events/EventLog'
export { StepInspector, type StepInspectorProps } from './inspector/StepInspector'
export { Timeline, type TimelineProps } from './timeline/Timeline'
export {
  createReplayWindow,
  type ReplayState,
  type ReplayWindow,
  type ReplayWindowStore,
} from './timeline/replay-window'
// ---- layout (for custom renderers / tests) ---------------------------------------------------
export {
  bundledElk,
  type EdgeRoute,
  type LayoutDirection,
  type LayoutEngine,
  type LayoutOptions,
  type LayoutResult,
  layoutGraph,
  type Placement,
  type Placements,
  type Point,
} from './layout/elk'
export {
  buildGraphModel,
  type GraphModel,
  type ModelEdge,
  type ModelEdgeKind,
  type ModelNode,
  type ModelNodeKind,
} from './layout/model'
// ---- live overlay ---------------------------------------------------------------------------
export { collectStatuses, overlayOf, runPhaseReader } from './status'
// ---- types ----------------------------------------------------------------------------------
export {
  type DevtoolsSource,
  type DevtoolsTheme,
  type GraphInput,
  type GraphSelection,
  isProjectedState,
  isRunSource,
  type MirrorSource,
  type ProjectedState,
  type ProjectedStep,
  type SnapshotLike,
  type StepPhase,
  type StepStatusInfo,
  type StepStatusMap,
  stepKey,
  type RunSource,
} from './types'
