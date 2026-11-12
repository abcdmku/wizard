/**
 * Positions for a wizard's steps and the arrows between them, computed by dagre. Dagre ranks the
 * steps, orders each rank to reduce crossings, routes an arrow that skips a rank around the steps
 * in between, and reserves room for every arrow label.
 */
import dagre from '@dagrejs/dagre'
import type { Manifest, ManifestEdge, ManifestStep } from '@openwizard/core/inspect'

export interface PlacedNode {
  readonly node: ManifestStep
  /** Top-left corner. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One arrow. Several connections between the same two steps share it. */
export interface PlacedArrow {
  readonly from: string
  readonly to: string
  readonly edges: readonly ManifestEdge[]
  readonly points: readonly { readonly x: number; readonly y: number }[]
  readonly label: string | null
  readonly labelX: number
  readonly labelY: number
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[]
  readonly arrows: readonly PlacedArrow[]
  readonly width: number
  readonly height: number
}

const NODE_HEIGHT = 46
const LABEL_CHAR = 6.4
const MARGIN = 12
const ANCHOR = '\u0000anchor'

/** Wide enough for the id at 12px and for the longest caption, `waiting for needs`. */
const nodeWidth = (node: ManifestStep, compact: boolean): number =>
  Math.max(compact ? 110 : 116, Math.min(230, node.id.length * 7.3 + (compact ? 14 : 30)))

/** The room an arrow's label takes, with a margin that keeps the line clear of the words. */
export const labelWidth = (label: string): number => label.length * LABEL_CHAR + 10

/** Graphs wider than this get a second, tighter layout for small screens. */
export const COMPACT_BELOW = 340

const formatMs = (ms: number): string =>
  ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`

/** The word on an arrow. A plain solid arrow needs none. */
function edgeWord(edge: ManifestEdge, from: ManifestStep | undefined): string | null {
  switch (edge.kind) {
    case 'needs':
      if (edge.mode === 'any') return 'first to finish'
      return edge.mode === 'optional' ? 'optional' : null
    case 'route':
      return 'may choose'
    case 'fallback':
      return 'on failure'
    case 'timeout':
      return from?.timeout === undefined ? 'on timeout' : `after ${formatMs(from.timeout)}`
    default:
      return null
  }
}

/** One wizard of a manifest: the steps and edges that share a child path. */
export function wizardsOf(manifest: Manifest): readonly {
  readonly path: readonly string[]
  readonly nodes: readonly ManifestStep[]
  readonly edges: readonly ManifestEdge[]
}[] {
  const byPath = new Map<
    string,
    { path: readonly string[]; nodes: ManifestStep[]; edges: ManifestEdge[] }
  >()
  for (const node of manifest.nodes) {
    const key = node.path.join('/')
    if (!byPath.has(key)) byPath.set(key, { path: node.path, nodes: [], edges: [] })
    byPath.get(key)?.nodes.push(node)
  }
  for (const edge of manifest.edges) byPath.get(edge.path.join('/'))?.edges.push(edge)
  return [...byPath.values()]
}

/** Lay out one wizard top to bottom. `compact` packs the steps closer for a small screen. */
export function layoutGraph(
  nodes: readonly ManifestStep[],
  edges: readonly ManifestEdge[],
  compact = false,
): GraphLayout {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: 'TB',
    nodesep: compact ? 10 : 26,
    ranksep: 46,
    edgesep: compact ? 6 : 18,
    marginx: compact ? 3 : 8,
    marginy: MARGIN,
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    graph.setNode(node.id, { width: nodeWidth(node, compact), height: NODE_HEIGHT })
  }

  const grouped = new Map<string, { from: string; to: string; edges: ManifestEdge[] }>()
  for (const edge of edges) {
    if (edge.from === null || edge.from === edge.to) continue
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue
    const key = `${edge.from}\u0000${edge.to}`
    const group = grouped.get(key) ?? { from: edge.from, to: edge.to, edges: [] }
    group.edges.push(edge)
    grouped.set(key, group)
  }
  const labels = new Map<string, string | null>()
  for (const [key, group] of grouped) {
    const words = new Set(
      group.edges.map((edge) => edgeWord(edge, byId.get(group.from))).filter(Boolean),
    )
    const label = words.size > 0 ? [...words].join(', ') : null
    labels.set(key, label)
    graph.setEdge(group.from, group.to, {
      labelpos: 'c',
      width: label ? labelWidth(label) : 0,
      height: label ? 18 : 0,
    })
  }

  // An unseen anchor above the steps that start the run keeps them on the top row. Without it
  // dagre moves a start step down to sit next to the late step that needs it.
  const starts = nodes.filter((node) => node.start)
  if (starts.length > 1) {
    graph.setNode(ANCHOR, { width: 0, height: 0 })
    for (const node of starts) graph.setEdge(ANCHOR, node.id, { weight: 4, width: 0, height: 0 })
  }

  dagre.layout(graph)
  // The anchor took a row of its own. Move everything up by the space that row left.
  const lift = Math.min(...nodes.map((node) => graph.node(node.id).y - NODE_HEIGHT / 2)) - MARGIN

  const placed = nodes.map((node): PlacedNode => {
    const at = graph.node(node.id)
    return {
      node,
      x: at.x - at.width / 2,
      y: at.y - at.height / 2 - lift,
      width: at.width,
      height: at.height,
    }
  })
  const arrows = [...grouped].map(([key, group]): PlacedArrow => {
    const at = graph.edge(group.from, group.to)
    const points = (at.points ?? []).map((point: { x: number; y: number }) => ({
      x: point.x,
      y: point.y - lift,
    }))
    const middle = points[Math.floor(points.length / 2)]
    return {
      from: group.from,
      to: group.to,
      edges: group.edges,
      points,
      label: labels.get(key) ?? null,
      labelX: at.x ?? middle?.x ?? 0,
      labelY: at.y === undefined ? (middle?.y ?? 0) : at.y - lift,
    }
  })
  const size = graph.graph()
  return { nodes: placed, arrows, width: size.width ?? 0, height: (size.height ?? 0) - lift }
}

/** A smooth path through dagre's points: straight ends, rounded corners in between. */
export function arrowPath(points: PlacedArrow['points']): string {
  const [first, ...rest] = points
  if (!first) return ''
  if (rest.length < 2)
    return `M ${first.x} ${first.y}${rest.map((p) => ` L ${p.x} ${p.y}`).join('')}`
  let path = `M ${first.x} ${first.y}`
  for (let i = 0; i < rest.length - 1; i += 1) {
    const corner = rest[i]
    const next = rest[i + 1]
    if (!corner || !next) continue
    const last = i === rest.length - 2
    const endX = last ? next.x : (corner.x + next.x) / 2
    const endY = last ? next.y : (corner.y + next.y) / 2
    path += ` Q ${corner.x} ${corner.y}, ${endX} ${endY}`
  }
  return path
}
