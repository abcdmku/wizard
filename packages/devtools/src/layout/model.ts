/**
 * Graph model: turn a `FlowGraph` (`inspect(flow)`) into the drawable model — one entry marker
 * per flow, a card per step (a `flow` step whose child is in the graph becomes a GROUP that
 * contains the child flow's model), a `?` port per dynamic `next`, and typed edges. Pure and
 * synchronous; the layout engine positions it, `toReactFlow` renders it.
 *
 * @packageDocumentation
 */

import type { FlowGraph } from '@openwizard/core'
import { type FlowGraphEdge, type FlowGraphNode, stepKey } from '../types'

/** Rendered size of a step card. */
export const STEP_WIDTH = 200
export const STEP_HEIGHT = 72
/** Rendered size of an entry / dynamic-next marker. */
export const MARKER_SIZE = 28
/** Room a group leaves for its header and around its children. */
export const GROUP_PADDING = { top: 60, right: 24, bottom: 24, left: 24 } as const

/**
 * Kind of a drawable node: a step card, a group (a `flow` step containing its child flow), a
 * flow's entry marker or the `?` port of a dynamic `next`.
 * @public
 */
export type ModelNodeKind = 'step' | 'group' | 'entry' | 'dynamic'

/**
 * Kind of a drawable edge: the `FlowGraph` kinds plus `dynamic` (a step → its `?` port).
 * @public
 */
export type ModelEdgeKind = FlowGraphEdge['kind'] | 'dynamic'

/**
 * One drawable node. `key` is unique across nesting levels (`stepKey(path, id)`, `#entry` /
 * `#dyn` suffixes for the markers); `parent` is the group key for nodes inside a child flow.
 * @public
 */
export interface ModelNode {
  readonly key: string
  readonly kind: ModelNodeKind
  /** The step this node stands for (absent for entry markers). */
  readonly step?: FlowGraphNode
  readonly path: readonly string[]
  readonly parent?: string
  readonly width: number
  readonly height: number
}

/**
 * One drawable edge between two model keys (`label` for `dependsOn` / `timeout` edges).
 * @public
 */
export interface ModelEdge {
  readonly key: string
  readonly source: string
  readonly target: string
  readonly kind: ModelEdgeKind
  readonly label?: string
  readonly path: readonly string[]
  /** The group both ends live in (absent at the root). */
  readonly parent?: string
}

/**
 * The drawable model of a `FlowGraph`: nodes (parents before children), edges and the warnings
 * by step key. Built by `buildGraphModel`, positioned by `layoutGraph`.
 * @public
 */
export interface GraphModel {
  readonly nodes: readonly ModelNode[]
  readonly edges: readonly ModelEdge[]
  /** Warnings by step key (`UNREACHABLE`, `NEVER_ACTIVATES`, `NAV_CYCLE`). */
  readonly warnings: Readonly<Record<string, readonly string[]>>
}

const pathId = (path: readonly string[]): string => path.join('/')
export const entryKey = (path: readonly string[]): string => `${pathId(path)}#entry`
export const dynamicKey = (key: string): string => `${key}#dyn`

/** The group (flow step) key that contains flow `path`, or undefined at the root. */
function parentOf(path: readonly string[]): string | undefined {
  const last = path[path.length - 1]
  return last === undefined ? undefined : stepKey(path.slice(0, -1), last)
}

/**
 * Build the drawable model of a `FlowGraph` (`inspect(flow)`): one entry marker per flow, a card
 * per step — a `flow` step whose child flow is in the graph becomes a group containing it — a
 * `?` port per dynamic `next`, and typed, labelled edges. Pure and synchronous.
 * @public
 */
export function buildGraphModel(graph: FlowGraph): GraphModel {
  const flowPaths = new Set(graph.nodes.map((n) => pathId(n.path)))
  const nodes: ModelNode[] = []
  const edges: ModelEdge[] = []
  const seenPaths = new Set<string>()
  for (const step of graph.nodes) {
    const parent = parentOf(step.path)
    const id = pathId(step.path)
    if (!seenPaths.has(id)) {
      seenPaths.add(id)
      nodes.push({
        key: entryKey(step.path),
        kind: 'entry',
        path: step.path,
        ...(parent === undefined ? {} : { parent }),
        width: MARKER_SIZE,
        height: MARKER_SIZE,
      })
    }
    const key = stepKey(step.path, step.id)
    const isGroup = step.kind === 'flow' && flowPaths.has(pathId([...step.path, step.id]))
    nodes.push({
      key,
      kind: isGroup ? 'group' : 'step',
      step,
      path: step.path,
      ...(parent === undefined ? {} : { parent }),
      width: STEP_WIDTH,
      height: STEP_HEIGHT,
    })
    if (step.dynamicNext === true) {
      nodes.push({
        key: dynamicKey(key),
        kind: 'dynamic',
        step,
        path: step.path,
        ...(parent === undefined ? {} : { parent }),
        width: MARKER_SIZE,
        height: MARKER_SIZE,
      })
      edges.push({
        key: `dynamic:${key}`,
        source: key,
        target: dynamicKey(key),
        kind: 'dynamic',
        label: 'next?',
        path: step.path,
        ...(parent === undefined ? {} : { parent }),
      })
    }
  }
  const byKey = new Map(graph.nodes.map((n) => [stepKey(n.path, n.id), n]))
  const used = new Set<string>()
  for (const edge of graph.edges) {
    const parent = parentOf(edge.path)
    const source = edge.from === null ? entryKey(edge.path) : stepKey(edge.path, edge.from)
    const target = stepKey(edge.path, edge.to)
    const base = `${edge.kind}:${source}->${target}`
    let key = base
    for (let n = 2; used.has(key); n += 1) key = `${base}#${n}`
    used.add(key)
    const label = edgeLabel(edge, byKey.get(source), byKey.get(target))
    edges.push({
      key,
      source,
      target,
      kind: edge.kind,
      ...(label === undefined ? {} : { label }),
      path: edge.path,
      ...(parent === undefined ? {} : { parent }),
    })
  }
  const warnings: Record<string, string[]> = {}
  for (const w of graph.warnings) {
    if (w.step === undefined) continue
    const key = stepKey(w.path, w.step)
    const list = warnings[key] ?? []
    list.push(w.code)
    warnings[key] = list
  }
  return { nodes, edges, warnings }
}

function edgeLabel(
  edge: FlowGraphEdge,
  source: FlowGraphNode | undefined,
  target: FlowGraphNode | undefined,
): string | undefined {
  switch (edge.kind) {
    case 'dependsOn':
      return target?.dependsOn !== undefined && 'any' in target.dependsOn
        ? 'dependsOn (any)'
        : 'dependsOn'
    case 'timeout':
      return source?.timeout === undefined ? 'timeout' : `timeout ${formatMs(source.timeout)}`
    default:
      return undefined
  }
}

/** `250ms`, `15s`, `15m`, `2h`, `1d` — the largest unit that divides evenly, else seconds. */
export function formatMs(ms: number): string {
  const units: ReadonlyArray<readonly [number, string]> = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1_000, 's'],
  ]
  for (const [size, unit] of units) if (ms >= size && ms % size === 0) return `${ms / size}${unit}`
  return ms < 1_000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`
}
