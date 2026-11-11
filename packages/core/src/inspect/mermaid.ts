/**
 * `toMermaid(graph)` — render a manifest (from `inspect(flow)`) as a Mermaid `flowchart TD`
 * titled with the flow name. Pure text; paste it into any Mermaid renderer.
 *
 * @packageDocumentation
 */

import { duration, Ids, quote, shape } from './mermaid-syntax'
import type { FlowGraph, FlowGraphEdge, FlowGraphNode } from './types'

/**
 * Render a manifest as Mermaid: one node per step (text = `label` or id, shape by kind: view
 * `[…]`, step `[[…]]`, flow `[/…/]`, plus a line of tags: `may skip` for a `when` guard,
 * attempts, run timeout, `compensable`), a start circle per flow, solid `next` edges, dashed
 * `route` edges to declared targets (a dashed edge to `?` when targets are undeclared),
 * `dependsOn` and named `needs` labels on joins (merged with activation edges),
 * dashed `timeout` and `fallback` edges, event nodes feeding waits, and every child flow
 * in a `subgraph` titled with its flow name. Deterministic for a given manifest.
 * @public
 */
export function toMermaid(graph: FlowGraph): string {
  const ids = new Ids()
  const flows = groupByPath(graph)
  const lines: string[] = ['---', `title: ${JSON.stringify(graph.name)}`, '---', 'flowchart TD']
  // Nodes and edges of a flow are declared inside its subgraph (root flow: top level).
  const render = (path: readonly string[], indent: string): void => {
    const group = flows.get(key(path))
    if (group === undefined) return
    const nodeId = (id: string): string => ids.of([...path, id])
    const waitTimeouts = new Set(group.edges.flatMap((e) => (e.kind === 'timeout' ? [e.from] : [])))
    for (const node of group.nodes) {
      const text = quote(node.label ?? node.id, ...tagLine(node, waitTimeouts.has(node.id)))
      lines.push(`${indent}${nodeId(node.id)}${shape(node.kind, text)}`)
    }
    const start = ids.of([...path, '$start'])
    if (group.edges.some((e) => e.kind === 'start')) lines.push(`${indent}${start}((" "))`)
    for (const edge of group.edges) {
      if (edge.kind === 'start') lines.push(`${indent}${start} --> ${nodeId(edge.to)}`)
    }
    for (const link of links(group)) {
      lines.push(`${indent}${nodeId(link.from)} ${link.arrow}${link.label} ${nodeId(link.to)}`)
    }
    for (const node of group.nodes) {
      for (const event of node.waitsFor ?? []) {
        const ev = ids.of([...path, '$event', event])
        lines.push(`${indent}${ev}>${quote(event)}] -.-> ${nodeId(node.id)}`)
      }
      if (node.dynamicNext === true && node.targets === undefined) {
        const q = ids.of([...path, node.id, '$next'])
        lines.push(`${indent}${nodeId(node.id)} -.-> ${q}{"?"}`)
      }
    }
    // Child flows: a subgraph per flow step that has one, linked from its step.
    for (const node of group.nodes) {
      const childPath = [...path, node.id]
      if (node.kind !== 'flow' || !flows.has(key(childPath))) continue
      const sg = ids.of([...childPath, '$flow'])
      lines.push(`${indent}subgraph ${sg} [${quote(node.child?.name ?? node.id)}]`)
      render(childPath, `${indent}  `)
      lines.push(`${indent}end`)
      lines.push(`${indent}${nodeId(node.id)} -.->|"child"| ${sg}`)
    }
  }
  render([], '  ')
  return lines.join('\n')
}

/** The second text line of a node: `may skip`, attempts, run timeout, `compensable`. */
function tagLine(node: FlowGraphNode, waitTimeout: boolean): string[] {
  const tags: string[] = []
  if (node.hooks.includes('when')) tags.push('may skip')
  if (node.retry !== undefined) tags.push(`${node.retry.attempts} attempts`)
  if (node.timeout !== undefined && !waitTimeout) tags.push(`timeout ${duration(node.timeout)}`)
  if (node.compensable === true) tags.push('compensable')
  if (node.sleep !== undefined)
    tags.push(node.sleep === 'dynamic' ? 'sleep (dynamic)' : `sleep ${duration(node.sleep)}`)
  if (node.each !== undefined)
    tags.push(
      node.each.concurrency === undefined ? 'each' : `each · concurrency ${node.each.concurrency}`,
    )
  return tags.length > 0 ? [tags.join(' · ')] : []
}

interface Link {
  readonly from: string
  readonly to: string
  readonly arrow: '-->' | '-.->'
  /** `|"…"|` or `''`. */
  readonly label: string
}

interface Pair {
  readonly from: string
  readonly to: string
  readonly kinds: Set<FlowGraphEdge['kind']>
}

/**
 * One link per step pair for normal and pull edges, then separate dashed alternate edges.
 */
function links(group: Group): Link[] {
  const pairs = new Map<string, Pair>()
  const alternates: Link[] = []
  for (const edge of group.edges) {
    if (edge.from === null || edge.kind === 'start') continue
    if (edge.kind === 'timeout' || edge.kind === 'fallback') {
      const ms = group.nodes.find((n) => n.id === edge.from)?.timeout
      const label =
        edge.kind === 'fallback'
          ? 'fallback'
          : ms === undefined
            ? 'timeout'
            : `timeout ${duration(ms)}`
      alternates.push({ from: edge.from, to: edge.to, arrow: '-.->', label: `|${quote(label)}|` })
      continue
    }
    const pair = JSON.stringify([edge.from, edge.to])
    const kinds = pairs.get(pair)?.kinds ?? new Set()
    kinds.add(edge.kind)
    if (!pairs.has(pair)) pairs.set(pair, { from: edge.from, to: edge.to, kinds })
  }
  return [...[...pairs.values()].map((pair) => pairLink(group, pair)), ...alternates]
}

function pairLink(group: Group, { from, to, kinds }: Pair): Link {
  const route = kinds.has('route') && !kinds.has('next')
  const spec = group.nodes.find((n) => n.id === to)?.dependsOn
  const parts: string[] = []
  if (route) parts.push('route')
  if (kinds.has('dependsOn'))
    parts.push(spec !== undefined && 'any' in spec ? 'dependsOn (any)' : 'dependsOn')
  if (kinds.has('needs')) {
    const needs = group.nodes.find((node) => node.id === to)?.needs ?? {}
    for (const [alias, need] of Object.entries(needs)) {
      if (need.steps.includes(from))
        parts.push(`needs: ${alias}${need.kind === 'all' ? '' : ` (${need.kind})`}`)
    }
  }
  return {
    from,
    to,
    arrow: route ? '-.->' : '-->',
    label: parts.length > 0 ? `|${quote(parts.join(' · '))}|` : '',
  }
}

interface Group {
  readonly nodes: FlowGraphNode[]
  readonly edges: FlowGraphEdge[]
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
