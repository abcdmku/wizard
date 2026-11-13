/**
 * ELK layered layout of a `GraphModel`: layers running right or down, compact spacing, right-angled
 * edge routes that keep clear of the cards and leave room for labels; groups (child wizards) are
 * compound ELK nodes with room for a header. Back edges (`findBackEdges`) are left out so the
 * algorithm sees a DAG; root nodes no edge touches (`findIsolated`) are parked after the rest.
 * The engine is injectable (tests / a worker-backed ELK); the default is the bundled elkjs.
 *
 * @packageDocumentation
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import { findBackEdges, findIsolated } from './cycles'
import { drawnEdges } from './merge'
import { GROUP_PADDING, type GraphModel, STEP_HEIGHT, STEP_WIDTH } from './model'

/**
 * Box of a laid-out node: absolute at the root, relative to its group inside a child wizard.
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
  /** Which way the layers run. */
  readonly direction: LayoutDirection
  /** The routed line of every edge ELK laid out, by edge key. */
  readonly routes: Readonly<Record<string, EdgeRoute>>
  /** Edges left out of the layered layout (drawn as U-turns / self-loops). */
  readonly backEdges: ReadonlySet<string>
  /** Root nodes parked in the isolated column. */
  readonly isolated: ReadonlySet<string>
}

/**
 * Which way the layers run: `right` puts the first step on the left, `down` puts it on top.
 * @public
 */
export type LayoutDirection = 'right' | 'down'

/**
 * Options for `layoutGraph`.
 * @public
 */
export interface LayoutOptions {
  /** Which way the layers run (default `right`). */
  readonly direction?: LayoutDirection
}

/**
 * A point in flow coordinates (absolute, the same space as the root placements).
 * @public
 */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * The line ELK routed for an edge, in absolute flow coordinates: right-angled bends that keep
 * clear of the cards, and the centre of the edge's label when it has one.
 * @public
 */
export interface EdgeRoute {
  readonly points: readonly Point[]
  readonly label?: Point
}

/** Height and padding of an edge label as the graph draws it, for the room ELK leaves. */
const LABEL_HEIGHT = 16
const LABEL_CHAR = 5.8
const LABEL_PAD = 10

function rootOptions(direction: LayoutDirection): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
    'elk.layered.spacing.nodeNodeBetweenLayers': direction === 'down' ? '32' : '40',
    'elk.spacing.nodeNode': direction === 'down' ? '24' : '18',
    'elk.spacing.edgeNode': '14',
    'elk.spacing.edgeEdge': '10',
    'elk.layered.spacing.edgeNodeBetweenLayers': '14',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
    'elk.spacing.edgeLabel': '4',
    'elk.edgeLabels.inline': 'true',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  }
}

const GROUP_OPTIONS: Readonly<Record<string, string>> = {
  'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`,
}

const ISOLATED_GAP = 44
const ISOLATED_STEP = 18

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
 * Lay a graph model out with ELK (layered, `options.direction` right or down, right-angled edge
 * routes): back edges are removed first so the algorithm sees a DAG, groups are compound nodes,
 * root nodes no edge touches are parked after the rest. Resolves to a placement for every node
 * and a route for every edge ELK laid out.
 * @public
 */
export async function layoutGraph(
  model: GraphModel,
  engine?: LayoutEngine,
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const direction = options.direction ?? 'right'
  const backEdges = findBackEdges(model.nodes, model.edges)
  const isolated = new Set<string>()
  for (const key of findIsolated(model.nodes, model.edges)) {
    const node = model.nodes.find((n) => n.key === key)
    if (node !== undefined && node.parent === undefined) isolated.add(key)
  }
  const root = toElk(model, backEdges, isolated, direction)
  const laidOut = await (engine ?? (await bundledElk())).layout(root)
  const placements: Record<string, Placement> = {}
  const routes: Record<string, EdgeRoute> = {}
  collect(laidOut, { x: 0, y: 0 }, placements, routes)
  parkIsolated(model, isolated, placements, direction)
  return { placements, direction, routes, backEdges, isolated }
}

/** The ELK input: a compound node per group, edges in the scope of their parent. */
function toElk(
  model: GraphModel,
  backEdges: ReadonlySet<string>,
  isolated: ReadonlySet<string>,
  direction: LayoutDirection,
): ElkNode {
  const root: ElkNode = {
    id: '__root__',
    layoutOptions: rootOptions(direction),
    children: [],
    edges: [],
  }
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
  for (const edge of drawnEdges(model.edges)) {
    if (backEdges.has(edge.key)) continue
    const elkEdge: ElkExtendedEdge = {
      id: edge.key,
      sources: [edge.source],
      targets: [edge.target],
      ...(edge.label === undefined
        ? {}
        : {
            labels: [
              {
                id: `${edge.key}:label`,
                text: edge.label,
                width: edge.label.length * LABEL_CHAR + LABEL_PAD,
                height: LABEL_HEIGHT,
              },
            ],
          }),
    }
    const scope = edge.parent === undefined ? root : (scopes.get(edge.parent) ?? root)
    if (scope.edges === undefined) scope.edges = []
    scope.edges.push(elkEdge)
  }
  return root
}

/** Placements relative to the parent, routes made absolute with the offset of their scope. */
function collect(
  node: ElkNode,
  offset: Point,
  into: Record<string, Placement>,
  routes: Record<string, EdgeRoute>,
): void {
  for (const edge of node.edges ?? []) {
    const section = edge.sections?.[0]
    if (section === undefined) continue
    const at = (p: Point): Point => ({ x: p.x + offset.x, y: p.y + offset.y })
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(at)
    const label = edge.labels?.[0]
    routes[edge.id] =
      label?.x === undefined || label.y === undefined
        ? { points }
        : {
            points,
            label: at({
              x: label.x + (label.width ?? 0) / 2,
              y: label.y + (label.height ?? 0) / 2,
            }),
          }
  }
  for (const child of node.children ?? []) {
    const x = child.x ?? 0
    const y = child.y ?? 0
    into[child.id] = { x, y, width: child.width ?? 0, height: child.height ?? 0 }
    collect(child, { x: offset.x + x, y: offset.y + y }, into, routes)
  }
}

/**
 * Isolated root nodes go after everything else: a column on the right when the layers run
 * right, a row underneath when they run down.
 */
function parkIsolated(
  model: GraphModel,
  isolated: ReadonlySet<string>,
  placements: Record<string, Placement>,
  direction: LayoutDirection,
): void {
  if (isolated.size === 0) return
  let right = 0
  let bottom = 0
  for (const node of model.nodes) {
    if (node.parent !== undefined) continue
    const p = placements[node.key]
    if (p === undefined) continue
    right = Math.max(right, p.x + p.width)
    bottom = Math.max(bottom, p.y + p.height)
  }
  let along = 0
  for (const node of model.nodes) {
    if (!isolated.has(node.key)) continue
    const { width, height } = node
    placements[node.key] =
      direction === 'down'
        ? { x: along, y: bottom + ISOLATED_GAP, width, height }
        : { x: right + ISOLATED_GAP, y: along, width, height }
    along +=
      (direction === 'down' ? Math.max(width, STEP_WIDTH) : Math.max(height, STEP_HEIGHT)) +
      ISOLATED_STEP
  }
}
