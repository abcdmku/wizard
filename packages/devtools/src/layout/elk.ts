/**
 * ELK layered layout of a `GraphModel`: left-to-right layers, spline routing, network-simplex
 * placement, 150 px between layers; groups (child flows) are compound ELK nodes laid out on
 * their own with room for a header. Back edges (`findBackEdges`) are left out so the algorithm
 * sees a DAG; root nodes no edge touches (`findIsolated`) are parked in a right-hand column.
 * The engine is injectable (tests / a worker-backed ELK); the default is the bundled elkjs.
 *
 * @packageDocumentation
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import { findBackEdges, findIsolated } from './cycles'
import { GROUP_PADDING, type GraphModel, STEP_HEIGHT } from './model'

/**
 * Box of a laid-out node: absolute at the root, relative to its group inside a child flow.
 * @public
 */
export interface Placement {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Placements by model key.
 * @public
 */
export type Placements = Readonly<Record<string, Placement>>

/**
 * What runs the layout: anything with ELK's `layout(graph)` — the bundled elkjs (default), a
 * worker-backed ELK, a stub in tests.
 * @public
 */
export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>
}

/**
 * What `layoutGraph` returns: the placements, the edges left out of the layered layout (drawn
 * as U-turns) and the root nodes parked in the isolated column.
 * @public
 */
export interface LayoutResult {
  readonly placements: Placements
  /** Edges left out of the layered layout (drawn as U-turns / self-loops). */
  readonly backEdges: ReadonlySet<string>
  /** Root nodes parked in the isolated column. */
  readonly isolated: ReadonlySet<string>
}

const ROOT_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.spacing.nodeNode': '48',
  'elk.spacing.edgeNode': '40',
  'elk.spacing.edgeEdge': '24',
  'elk.edgeRouting': 'SPLINES',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
}

const GROUP_OPTIONS: Readonly<Record<string, string>> = {
  'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`,
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
  'elk.spacing.nodeNode': '40',
}

const ISOLATED_GAP_X = 100
const ISOLATED_GAP_Y = 32
const ISOLATED_TOP = 40

let bundledEngine: Promise<LayoutEngine> | undefined

/**
 * The bundled elkjs engine (no worker) — loaded once, lazily, so importing the package stays
 * cheap until a graph is drawn.
 * @public
 */
export function bundledElk(): Promise<LayoutEngine> {
  bundledEngine ??= import('elkjs/lib/elk.bundled.js').then((mod) => {
    const Ctor = mod.default
    return new Ctor()
  })
  return bundledEngine
}

/**
 * Lay a graph model out with ELK (layered, left → right, 150 px between layers, splines, network
 * simplex): back edges are removed first so the algorithm sees a DAG, groups are compound nodes,
 * root nodes no edge touches are parked in a right-hand column. Resolves to a placement for
 * every node.
 * @public
 */
export async function layoutGraph(model: GraphModel, engine?: LayoutEngine): Promise<LayoutResult> {
  const backEdges = findBackEdges(model.nodes, model.edges)
  const isolated = new Set<string>()
  for (const key of findIsolated(model.nodes, model.edges)) {
    const node = model.nodes.find((n) => n.key === key)
    if (node !== undefined && node.parent === undefined) isolated.add(key)
  }
  const root = toElk(model, backEdges, isolated)
  const laidOut = await (engine ?? (await bundledElk())).layout(root)
  const placements: Record<string, Placement> = {}
  collectPlacements(laidOut, placements)
  parkIsolated(model, isolated, placements)
  return { placements, backEdges, isolated }
}

/** The ELK input: a compound node per group, edges in the scope of their parent. */
function toElk(
  model: GraphModel,
  backEdges: ReadonlySet<string>,
  isolated: ReadonlySet<string>,
): ElkNode {
  const root: ElkNode = { id: '__root__', layoutOptions: ROOT_OPTIONS, children: [], edges: [] }
  const scopes = new Map<string, ElkNode>()
  for (const node of model.nodes) {
    if (isolated.has(node.key)) continue
    const elkNode: ElkNode =
      node.kind === 'group'
        ? { id: node.key, layoutOptions: GROUP_OPTIONS, children: [], edges: [] }
        : { id: node.key, width: node.width, height: node.height }
    if (node.kind === 'group') scopes.set(node.key, elkNode)
    const scope = node.parent === undefined ? root : (scopes.get(node.parent) ?? root)
    if (scope.children === undefined) scope.children = []
    scope.children.push(elkNode)
  }
  for (const edge of model.edges) {
    if (backEdges.has(edge.key)) continue
    const elkEdge: ElkExtendedEdge = {
      id: edge.key,
      sources: [edge.source],
      targets: [edge.target],
    }
    const scope = edge.parent === undefined ? root : (scopes.get(edge.parent) ?? root)
    if (scope.edges === undefined) scope.edges = []
    scope.edges.push(elkEdge)
  }
  return root
}

function collectPlacements(node: ElkNode, into: Record<string, Placement>): void {
  for (const child of node.children ?? []) {
    into[child.id] = {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    }
    collectPlacements(child, into)
  }
}

/** Isolated root nodes go in a column right of everything else, top to bottom. */
function parkIsolated(
  model: GraphModel,
  isolated: ReadonlySet<string>,
  placements: Record<string, Placement>,
): void {
  if (isolated.size === 0) return
  let right = 0
  for (const node of model.nodes) {
    if (node.parent !== undefined) continue
    const p = placements[node.key]
    if (p !== undefined) right = Math.max(right, p.x + p.width)
  }
  let y = ISOLATED_TOP
  for (const node of model.nodes) {
    if (!isolated.has(node.key)) continue
    placements[node.key] = { x: right + ISOLATED_GAP_X, y, width: node.width, height: node.height }
    y += Math.max(node.height, STEP_HEIGHT) + ISOLATED_GAP_Y
  }
}
