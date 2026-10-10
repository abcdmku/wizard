/**
 * From the laid-out model to React Flow nodes and edges: step cards, group containers (child
 * flows) with `parentId` + relative positions, entry / `?` markers, and typed edges with the
 * handles `pickHandles` chose. The live overlay (statuses, current view, selection) only touches
 * `data`, so `applyOverlay` can refresh it without resetting positions the user dragged.
 *
 * @packageDocumentation
 */

import type { Edge, Node } from '@xyflow/react'
import type { LayoutResult, Placement } from '../layout/elk'
import { pickHandles } from '../layout/handles'
import type { GraphModel, ModelEdge, ModelEdgeKind, ModelNode } from '../layout/model'
import type { FlowGraphNode, StepStatusInfo, StepStatusMap } from '../types'

/** What the graph overlays on the static model right now. */
export interface GraphOverlay {
  readonly statuses: StepStatusMap
  /** Key of the current view (highlighted). */
  readonly current: string | null
  /** Key of the selected step. */
  readonly selected: string | null
}

export type StepNodeData = {
  readonly nodeKey: string
  readonly step: FlowGraphNode
  readonly path: readonly string[]
  readonly warnings: readonly string[]
  readonly live: StepStatusInfo | undefined
  readonly current: boolean
  readonly selected: boolean
}

export type MarkerNodeData = {
  readonly variant: 'entry' | 'dynamic'
  readonly path: readonly string[]
}

export type FlowEdgeData = {
  readonly kind: ModelEdgeKind
  readonly label?: string
  /** Left out of the layered layout (drawn as a U-turn / self-loop). */
  readonly back: boolean
}

export type StepNode = Node<StepNodeData, 'step'>
export type GroupNode = Node<StepNodeData, 'group'>
export type MarkerNode = Node<MarkerNodeData, 'marker'>
export type DevtoolsNode = StepNode | GroupNode | MarkerNode
export type DevtoolsEdge = Edge<FlowEdgeData, 'flow'>

export const EMPTY_OVERLAY: GraphOverlay = { statuses: {}, current: null, selected: null }

function stepData(
  node: ModelNode,
  step: FlowGraphNode,
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
  }
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

function toEdge(edge: ModelEdge, layout: LayoutResult): DevtoolsEdge | undefined {
  const source = layout.placements[edge.source]
  const target = layout.placements[edge.target]
  if (source === undefined || target === undefined) return undefined
  const handles = pickHandles(source, target)
  return {
    id: edge.key,
    source: edge.source,
    target: edge.target,
    sourceHandle: handles.sourceHandle,
    targetHandle: handles.targetHandle,
    type: 'flow',
    data: {
      kind: edge.kind,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      back: layout.backEdges.has(edge.key),
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
  for (const edge of model.edges) {
    const e = toEdge(edge, layout)
    if (e !== undefined) edges.push(e)
  }
  return { nodes, edges }
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
    }
    return { ...node, data }
  })
}
