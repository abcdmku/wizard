/**
 * From the laid-out model to React Flow nodes and edges: step cards, group containers (child
 * wizards) with `parentId` + relative positions, entry / `?` markers, and typed edges with the
 * handles `pickHandles` chose. The live overlay (statuses, current view, selection) only touches
 * `data`, so `applyOverlay` can refresh it without resetting positions the user dragged.
 *
 * @packageDocumentation
 */

import type { ManifestStep } from '@openwizard/core/inspect'
import type { Edge, Node } from '@xyflow/react'
import type { EdgeRoute, LayoutResult, Placement, Point } from '../layout/elk'
import { pickHandles } from '../layout/handles'
import { drawnEdges, isAnyNeed } from '../layout/merge'
import type { GraphModel, ModelEdge, ModelEdgeKind, ModelNode } from '../layout/model'
import type { StepStatusInfo, StepStatusMap } from '../types'
import { applyEdgeOverlay } from './paths'

export { applyEdgeOverlay } from './paths'

/**
 * Why an idle step will not start: the run `ended`, the run is `undoing` its steps, or the
 * steps that lead to it went another way (`closed`).
 */
export type NotRunReason = 'ended' | 'undoing' | 'closed'

/** What the graph overlays on the static model right now. */
export interface GraphOverlay {
  readonly statuses: StepStatusMap
  /** Key of the current view (highlighted). */
  readonly current: string | null
  /** Key of the selected step. */
  readonly selected: string | null
  /** Keys of the steps that wait on a person, when the host says which. */
  readonly attention?: ReadonlySet<string>
  /** The run has ended or is undoing, so no idle step will start. */
  readonly stopped?: Exclude<NotRunReason, 'closed'>
  /** Keys of the idle steps that can no longer start (`closedSteps`). */
  readonly closed?: ReadonlySet<string>
}

export type StepNodeData = {
  readonly nodeKey: string
  readonly step: ManifestStep
  readonly path: readonly string[]
  readonly warnings: readonly string[]
  readonly live: StepStatusInfo | undefined
  readonly current: boolean
  readonly selected: boolean
  /** The host says a person has to act on this step (`undefined` when it does not say). */
  readonly attention: boolean | undefined
  /** Why the step will not start, when it is idle and will not. */
  readonly notRun: NotRunReason | undefined
  /** The steps this one needs any one of (`needs: { x: { any: [a, b] } }`), by step id. */
  readonly anyOf: readonly string[]
}

type MarkerNodeData = {
  readonly variant: 'entry' | 'dynamic'
  readonly path: readonly string[]
}

type GraphEdgeData = {
  readonly kind: ModelEdgeKind
  readonly label?: string
  /** Left out of the layered layout (drawn as a U-turn / self-loop). */
  readonly back: boolean
  /** With a live run: the run went this way (`taken`) or cannot any more (`untaken`). */
  readonly path?: EdgePathState
  /** The line also carries a need, so the target reads the source's output along it. */
  readonly need?: boolean
  /** The line ELK routed, drawn while both ends stay where the layout put them. */
  readonly route?: EdgeRoute
  /** Where the layout put both ends (absolute), to tell when a card was dragged. */
  readonly ends?: { readonly source: Point; readonly target: Point }
}

/**
 * Whether the run went along an edge, from the statuses at both ends. `carried` is a timeout or
 * fallback line that also carries a need, when the run went along the need: the source finished
 * and the target read its output, so the line is drawn as a taken need.
 */
export type EdgePathState = 'taken' | 'untaken' | 'carried'

export type StepNode = Node<StepNodeData, 'step'>
export type GroupNode = Node<StepNodeData, 'group'>
export type MarkerNode = Node<MarkerNodeData, 'marker'>
export type DevtoolsNode = StepNode | GroupNode | MarkerNode
export type DevtoolsEdge = Edge<GraphEdgeData, 'graph'>

function stepData(
  node: ModelNode,
  step: ManifestStep,
  model: GraphModel,
  overlay: GraphOverlay,
): StepNodeData {
  return {
    nodeKey: node.key,
    step,
    path: node.path,
    warnings: model.warnings[node.key] ?? [],
    live: overlay.statuses[node.key],
    current: overlay.current === node.key,
    selected: overlay.selected === node.key,
    attention: attentionOf(overlay, node.key),
    notRun: notRunOf(overlay, node.key),
    anyOf: anyOf(model, node.key),
  }
}

/** The ids of the steps a step joins with `any`, from the labels of the model's `needs` edges. */
function anyOf(model: GraphModel, key: string): readonly string[] {
  return model.edges
    .filter((e) => e.target === key && isAnyNeed(e))
    .map((e) => e.source.slice(e.source.lastIndexOf('/') + 1))
}

function notRunOf(overlay: GraphOverlay, key: string): NotRunReason | undefined {
  if (overlay.statuses[key]?.status !== 'idle') return undefined
  return overlay.stopped ?? (overlay.closed?.has(key) === true ? 'closed' : undefined)
}

function attentionOf(overlay: GraphOverlay, key: string): boolean | undefined {
  return overlay.attention === undefined ? undefined : overlay.attention.has(key)
}

function toNode(
  node: ModelNode,
  place: Placement,
  model: GraphModel,
  overlay: GraphOverlay,
): DevtoolsNode {
  const base = {
    id: node.key,
    position: { x: place.x, y: place.y },
    ...(node.parent === undefined ? {} : { parentId: node.parent, extent: 'parent' as const }),
    connectable: false,
    deletable: false,
  }
  if (node.kind === 'entry' || node.kind === 'dynamic') {
    return {
      ...base,
      type: 'marker',
      data: { variant: node.kind, path: node.path },
      width: place.width,
      height: place.height,
      selectable: false,
      draggable: false,
      // The marker does nothing when pressed, so it is not a tab stop.
      focusable: false,
    }
  }
  const step = node.step
  if (step === undefined) throw new Error(`model node '${node.key}' has no step`)
  const data = stepData(node, step, model, overlay)
  if (node.kind === 'group') {
    return {
      ...base,
      type: 'group',
      data,
      width: place.width,
      height: place.height,
      style: { width: place.width, height: place.height },
      draggable: true,
      zIndex: -1,
    }
  }
  return { ...base, type: 'step', data, width: place.width, height: place.height, draggable: true }
}

/** Absolute positions: placements inside a group are relative to it. */
function absolute(model: GraphModel, layout: LayoutResult): Map<string, Point> {
  const at = new Map<string, Point>()
  for (const node of model.nodes) {
    const p = layout.placements[node.key]
    if (p === undefined) continue
    const parent = node.parent === undefined ? undefined : at.get(node.parent)
    at.set(node.key, parent === undefined ? p : { x: parent.x + p.x, y: parent.y + p.y })
  }
  return at
}

function toEdge(
  edge: ModelEdge,
  layout: LayoutResult,
  at: ReadonlyMap<string, Point>,
  needs: ReadonlySet<string>,
): DevtoolsEdge | undefined {
  const source = layout.placements[edge.source]
  const target = layout.placements[edge.target]
  const sourceAt = at.get(edge.source)
  const targetAt = at.get(edge.target)
  if (source === undefined || target === undefined) return undefined
  if (sourceAt === undefined || targetAt === undefined) return undefined
  const handles = pickHandles(
    { ...source, ...sourceAt },
    { ...target, ...targetAt },
    layout.direction,
  )
  const route = layout.routes[edge.key]
  return {
    id: edge.key,
    source: edge.source,
    target: edge.target,
    sourceHandle: handles.sourceHandle,
    targetHandle: handles.targetHandle,
    type: 'graph',
    data: {
      kind: edge.kind,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      back: layout.backEdges.has(edge.key),
      ...(needs.has(`${edge.source}\n${edge.target}`) ? { need: true } : {}),
      ...(route === undefined ? {} : { route, ends: { source: sourceAt, target: targetAt } }),
    },
    focusable: false,
    deletable: false,
  }
}

/** Nodes (parents before children, as the model orders them) and edges for React Flow. */
export function toReactFlow(
  model: GraphModel,
  layout: LayoutResult,
  overlay: GraphOverlay,
): { readonly nodes: DevtoolsNode[]; readonly edges: DevtoolsEdge[] } {
  const nodes: DevtoolsNode[] = []
  for (const node of model.nodes) {
    const place = layout.placements[node.key]
    if (place !== undefined) nodes.push(toNode(node, place, model, overlay))
  }
  const edges: DevtoolsEdge[] = []
  const at = absolute(model, layout)
  const needs = new Set(
    model.edges.filter((e) => e.kind === 'needs').map((e) => `${e.source}\n${e.target}`),
  )
  for (const edge of drawnEdges(model.edges)) {
    const e = toEdge(edge, layout, at, needs)
    if (e !== undefined) edges.push(e)
  }
  return { nodes, edges: applyEdgeOverlay(edges, overlay) }
}

/** Refresh the live overlay in `data` only — positions (dragged or not) are kept. */
export function applyOverlay(
  nodes: readonly DevtoolsNode[],
  overlay: GraphOverlay,
): DevtoolsNode[] {
  return nodes.map((node) => {
    if (node.type === 'marker') return node
    const data: StepNodeData = {
      ...node.data,
      live: overlay.statuses[node.id],
      current: overlay.current === node.id,
      selected: overlay.selected === node.id,
      attention: attentionOf(overlay, node.id),
      notRun: notRunOf(overlay, node.id),
    }
    return { ...node, data }
  })
}
