/**
 * `toMermaid(graph)` — render a `FlowGraph` (from `inspect(flow)`) as a Mermaid `flowchart TD`
 * (plan §9.8): one node per step labelled `id (kind)` (shape by kind), `start` circles, solid
 * `next` edges, `dependsOn` edges labelled (`dependsOn` / `dependsOn (any)`), `timeout` edges
 * dashed and labelled with the duration, a dynamic `next` as a dashed edge to a `?` node, and
 * every child flow in a `subgraph` linked from its flow step. Pure text; paste it into any
 * Mermaid renderer.
 *
 * @packageDocumentation
 */

import type { FlowGraph, FlowGraphNode } from './graph'

const RESERVED = new Set([
  'end',
  'graph',
  'subgraph',
  'flowchart',
  'style',
  'classdef',
  'class',
  'click',
  'linkstyle',
  'direction',
])

/**
 * Render a `FlowGraph` as Mermaid (`flowchart TD`): nodes `id (kind)`, `next` edges, labelled
 * `dependsOn` edges, dashed labelled `timeout` edges, dynamic `next` as a dashed edge to a `?`
 * node, child flows as subgraphs. Deterministic for a given graph.
 * @public
 */
export function toMermaid(graph: FlowGraph): string {
  const ids = new Ids()
  const lines: string[] = ['flowchart TD']
  const flows = groupByPath(graph)
  const declaredStarts = new Set<string>()
  // Nodes and edges of a flow are declared inside its subgraph (root flow: top level).
  const render = (path: readonly string[], indent: string): void => {
    const group = flows.get(key(path))
    if (group === undefined) return
    const nodeId = (id: string): string => ids.of([...path, id])
    for (const node of group.nodes) {
      lines.push(`${indent}${nodeId(node.id)}${shape(node.kind, `${node.id} (${node.kind})`)}`)
    }
    for (const edge of group.edges) {
      if (edge.from === null) {
        // `start` edges: one small circle per flow.
        const start = ids.of([...path, '$start'])
        if (!declaredStarts.has(start)) {
          declaredStarts.add(start)
          lines.push(`${indent}${start}((" "))`)
        }
        lines.push(`${indent}${start} --> ${nodeId(edge.to)}`)
        continue
      }
      const from = nodeId(edge.from)
      const to = nodeId(edge.to)
      switch (edge.kind) {
        case 'next':
          lines.push(`${indent}${from} --> ${to}`)
          break
        case 'dependsOn': {
          const spec = group.nodes.find((n) => n.id === edge.to)?.dependsOn
          const label = spec !== undefined && 'any' in spec ? 'dependsOn (any)' : 'dependsOn'
          lines.push(`${indent}${from} -->|${label}| ${to}`)
          break
        }
        case 'timeout': {
          const ms = group.nodes.find((n) => n.id === edge.from)?.timeout
          lines.push(
            `${indent}${from} -.->|timeout${ms === undefined ? '' : ` ${duration(ms)}`}| ${to}`,
          )
          break
        }
        default:
          break
      }
    }
    for (const node of group.nodes) {
      if (node.dynamicNext !== true) continue
      const q = ids.of([...path, node.id, '$next'])
      lines.push(`${indent}${nodeId(node.id)} -.-> ${q}{"?"}`)
    }
    // Child flows: a subgraph per flow step that has one, linked from its step.
    for (const node of group.nodes) {
      if (node.kind !== 'flow') continue
      const childPath = [...path, node.id]
      if (!flows.has(key(childPath))) continue
      const sg = ids.of([...childPath, '$flow'])
      lines.push(`${indent}subgraph ${sg} ["${quote(node.id)}"]`)
      render(childPath, `${indent}  `)
      lines.push(`${indent}end`)
      lines.push(`${indent}${nodeId(node.id)} -.->|child| ${sg}`)
    }
  }
  render([], '  ')
  return lines.join('\n')
}

interface Group {
  readonly nodes: FlowGraphNode[]
  readonly edges: FlowGraph['edges'][number][]
}

function groupByPath(graph: FlowGraph): Map<string, Group> {
  const groups = new Map<string, Group>()
  const groupOf = (path: readonly string[]): Group => {
    const k = key(path)
    let g = groups.get(k)
    if (g === undefined) {
      g = { nodes: [], edges: [] }
      groups.set(k, g)
    }
    return g
  }
  for (const node of graph.nodes) groupOf(node.path).nodes.push(node)
  for (const edge of graph.edges) groupOf(edge.path).edges.push(edge)
  return groups
}

function key(path: readonly string[]): string {
  return JSON.stringify(path)
}

/** Stable, unique, Mermaid-safe identifiers for (path, id) pairs. */
class Ids {
  private readonly byKey = new Map<string, string>()
  private readonly taken = new Set<string>()

  of(segments: readonly string[]): string {
    const k = key(segments)
    const existing = this.byKey.get(k)
    if (existing !== undefined) return existing
    let base = segments.map(sanitize).join('__')
    if (base.length === 0 || /^[0-9]/.test(base)) base = `n_${base}`
    if (RESERVED.has(base.toLowerCase())) base = `${base}_`
    let candidate = base
    for (let n = 2; this.taken.has(candidate); n += 1) candidate = `${base}_${n}`
    this.taken.add(candidate)
    this.byKey.set(k, candidate)
    return candidate
  }
}

function sanitize(segment: string): string {
  return segment.replace(/^\$/, '_').replace(/[^A-Za-z0-9_]/g, '_')
}

function quote(text: string): string {
  return text.replace(/"/g, '#quot;')
}

function shape(kind: FlowGraphNode['kind'], label: string): string {
  const text = `"${quote(label)}"`
  switch (kind) {
    case 'view':
      return `[${text}]`
    case 'task':
      return `[[${text}]]`
    case 'wait':
      return `([${text}])`
    case 'decision':
      return `{${text}}`
    case 'flow':
      return `[/${text}/]`
    case 'final':
      return `((${text}))`
  }
}

/** `900000` → `15m`; falls back to the largest whole unit, else `ms`. */
function duration(ms: number): string {
  const units: ReadonlyArray<readonly [suffix: string, size: number]> = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ]
  for (const [suffix, size] of units)
    if (ms >= size && ms % size === 0) return `${ms / size}${suffix}`
  return `${ms}ms`
}
