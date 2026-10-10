/**
 * @openwizard/devtools — React devtools for OpenWizard: `<FlowGraph>` (React Flow + ELK graph
 * of `inspect(flow)` with a live status overlay), `<EventLog>`, `<StepInspector>`, `<Timeline>`
 * (time travel with `replay`) and the dockable `<Devtools>` panel that composes them over a
 * `Wizard` or a `Mirror`. Import `@openwizard/devtools/style.css` once for the styles.
 *
 * @packageDocumentation
 */

// biome-ignore assist/source/organizeImports: hand-grouped by concept
export { Devtools, type DevtoolsProps } from './devtools/Devtools'
export type { DockPosition } from './devtools/use-resize'
export { FlowGraph, type FlowGraphProps } from './graph/FlowGraph'
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
  type LayoutEngine,
  type LayoutResult,
  layoutGraph,
  type Placement,
  type Placements,
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
export { collectStatuses, overlayOf, wizardPhaseReader } from './status'
// ---- types ----------------------------------------------------------------------------------
export {
  type DevtoolsSource,
  type DevtoolsTheme,
  type FlowGraphEdge,
  type FlowGraphNode,
  type GraphInput,
  type GraphSelection,
  isProjectedState,
  isWizardSource,
  type MirrorSource,
  type ProjectedState,
  type ProjectedStep,
  type SnapshotLike,
  type StepPhase,
  type StepStatusInfo,
  type StepStatusMap,
  stepKey,
  type WizardSource,
} from './types'
