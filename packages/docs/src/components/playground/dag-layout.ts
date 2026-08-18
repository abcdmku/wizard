/**
 * A small layered ("Sugiyama-lite") layout for the graphs `inspect(flow)` returns: longest-path
 * layering from the start nodes, a few barycenter sweeps to reduce crossings, then top-down
 * coordinates. Pure data in, positions out — the SVG rendering lives in `flow-graph.tsx`.
 */
import type { FlowGraph } from '@openwizard/core'

type FlowGraphNode = FlowGraph['nodes'][number]
type FlowGraphEdge = FlowGraph['edges'][number]

export type { FlowGraphEdge, FlowGraphNode }

export interface LaidOutNode {
  readonly node: FlowGraphNode
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface LaidOutEdge {
  readonly edge: FlowGraphEdge
  readonly from: LaidOutNode
  readonly to: LaidOutNode
  /** The edge points to an earlier (or the same) layer: drawn as a loop around the nodes. */
  readonly back: boolean
}

export interface DagLayout {
  readonly nodes: readonly LaidOutNode[]
  readonly edges: readonly LaidOutEdge[]
  readonly width: number
  readonly height: number
}

export const NODE_HEIGHT = 44
const LAYER_GAP = 44
const NODE_GAP = 28
const PADDING = 12

const nodeWidth = (node: FlowGraphNode): number =>
  Math.max(104, Math.min(220, node.id.length * 7.4 + 48))

/** One flow of the graph = the nodes and edges sharing a `path`. */
export function flowsOf(graph: FlowGraph): ReadonlyArray<{
  readonly path: readonly string[]
  readonly nodes: readonly FlowGraphNode[]
  readonly edges: readonly FlowGraphEdge[]
}> {
  const byPath = new Map<
    string,
    { path: readonly string[]; nodes: FlowGraphNode[]; edges: FlowGraphEdge[] }
  >()
  for (const node of graph.nodes) {
    const key = node.path.join('/')
    if (!byPath.has(key)) byPath.set(key, { path: node.path, nodes: [], edges: [] })
    byPath.get(key)?.nodes.push(node)
  }
  for (const edge of graph.edges) byPath.get(edge.path.join('/'))?.edges.push(edge)
  return [...byPath.values()]
}

/** Longest-path layers; DFS back edges (cycles through `next`) are excluded from layering. */
function assignLayers(nodes: readonly FlowGraphNode[], edges: readonly FlowGraphEdge[]) {
  const ids = nodes.map((node) => node.id)
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  const directed = edges.filter(
    (edge): edge is FlowGraphEdge & { from: string } =>
      edge.from !== null && out.has(edge.from) && out.has(edge.to) && edge.from !== edge.to,
  )
  for (const edge of directed) out.get(edge.from)?.push(edge.to)

  const state = new Map<string, 'open' | 'done'>()
  const backEdges = new Set<string>()
  const visit = (id: string) => {
    state.set(id, 'open')
    for (const next of out.get(id) ?? []) {
      const s = state.get(next)
      if (s === 'open') backEdges.add(`${id}->${next}`)
      else if (s === undefined) visit(next)
    }
    state.set(id, 'done')
  }
  const starts = nodes.filter((node) => node.start).map((node) => node.id)
  for (const id of [...starts, ...ids]) if (!state.has(id)) visit(id)

  const forward = directed.filter((edge) => !backEdges.has(`${edge.from}->${edge.to}`))
  const inbound = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of forward) inbound.get(edge.to)?.push(edge.from)
  const layer = new Map<string, number>()
  const depth = (id: string): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    layer.set(id, 0) // guards against unexpected cycles
    const value = Math.max(-1, ...(inbound.get(id) ?? []).map(depth)) + 1
    layer.set(id, value)
    return value
  }
  for (const id of ids) depth(id)
  return { layer, backEdges }
}

/** Order nodes inside each layer by the mean position of their neighbours (a few sweeps). */
function orderLayers(
  nodes: readonly FlowGraphNode[],
  edges: readonly FlowGraphEdge[],
  layer: ReadonlyMap<string, number>,
): FlowGraphNode[][] {
  const layers: FlowGraphNode[][] = []
  for (const node of nodes) {
    const index = layer.get(node.id) ?? 0
    layers[index] ??= []
    layers[index]?.push(node)
  }
  const position = new Map<string, number>()
  const refresh = () => {
    for (const row of layers) {
      for (const [i, node] of (row ?? []).entries()) position.set(node.id, i)
    }
  }
  refresh()
  const neighbours = (id: string, upward: boolean) =>
    edges
      .filter((edge) => (upward ? edge.to === id : edge.from === id))
      .map((edge) => (upward ? edge.from : edge.to))
      .filter((other): other is string => other !== null && position.has(other))
  const sweep = (upward: boolean) => {
    const order = upward ? layers.keys() : [...layers.keys()].reverse()
    for (const index of order) {
      const row = layers[index]
      if (!row || (upward && index === 0)) continue
      const bary = new Map(
        row.map((node) => {
          const around = neighbours(node.id, upward).map((id) => position.get(id) ?? 0)
          const mean =
            around.length === 0
              ? (position.get(node.id) ?? 0)
              : around.reduce((a, b) => a + b, 0) / around.length
          return [node.id, mean]
        }),
      )
      row.sort((a, b) => (bary.get(a.id) ?? 0) - (bary.get(b.id) ?? 0))
      refresh()
    }
  }
  for (let i = 0; i < 3; i += 1) {
    sweep(true)
    sweep(false)
  }
  return layers.map((row) => row ?? [])
}

/** Layout one flow (nodes/edges of a single `path`) top-down. */
export function layoutFlow(
  nodes: readonly FlowGraphNode[],
  edges: readonly FlowGraphEdge[],
): DagLayout {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }
  const { layer, backEdges } = assignLayers(nodes, edges)
  const layers = orderLayers(nodes, edges, layer)
  const rowWidths = layers.map(
    (row) =>
      row.reduce((sum, node) => sum + nodeWidth(node), 0) + Math.max(0, row.length - 1) * NODE_GAP,
  )
  const width = Math.max(...rowWidths) + PADDING * 2
  const placed = new Map<string, LaidOutNode>()
  layers.forEach((row, layerIndex) => {
    let x = (width - (rowWidths[layerIndex] ?? 0)) / 2
    for (const node of row) {
      const w = nodeWidth(node)
      placed.set(node.id, {
        node,
        x,
        y: PADDING + layerIndex * (NODE_HEIGHT + LAYER_GAP),
        width: w,
        height: NODE_HEIGHT,
      })
      x += w + NODE_GAP
    }
  })
  const laidEdges: LaidOutEdge[] = []
  for (const edge of edges) {
    if (edge.from === null) continue
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (!from || !to) continue
    laidEdges.push({
      edge,
      from,
      to,
      back: backEdges.has(`${edge.from}->${edge.to}`) || to.y <= from.y,
    })
  }
  return {
    nodes: [...placed.values()],
    edges: laidEdges,
    width,
    height: PADDING * 2 + layers.length * NODE_HEIGHT + (layers.length - 1) * LAYER_GAP,
  }
}
