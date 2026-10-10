/**
 * Layout pre-pass: which edges point "backwards" (they close a cycle — `NAV_CYCLE`, a self-loop,
 * a `back`-like `next`) and which nodes are isolated (no edge at all). Back edges are left out
 * of the layered layout so ELK sees a DAG, then drawn as U-turns; isolated nodes are parked in
 * a column of their own instead of cluttering the first layer.
 *
 * @packageDocumentation
 */

import type { ModelEdge, ModelNode } from './model'

/**
 * Back edges by DFS from the entry markers (an edge to a node still on the DFS stack closes a
 * cycle; a self-loop always does). Every flow (root and each group) is searched from its own
 * entry marker; nodes unreachable from an entry are searched afterwards so a cycle among them
 * is broken too. Returns the keys of the back edges.
 */
export function findBackEdges(
  nodes: readonly ModelNode[],
  edges: readonly ModelEdge[],
): Set<string> {
  const out = new Map<string, ModelEdge[]>()
  for (const node of nodes) out.set(node.key, [])
  for (const edge of edges) out.get(edge.source)?.push(edge)
  const back = new Set<string>()
  const state = new Map<string, 'open' | 'done'>()
  const visit = (start: string): void => {
    // Iterative DFS with an explicit edge cursor per frame.
    const stack: Array<{ key: string; next: number }> = [{ key: start, next: 0 }]
    state.set(start, 'open')
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame === undefined) break
      const outgoing = out.get(frame.key) ?? []
      const edge = outgoing[frame.next]
      if (edge === undefined) {
        state.set(frame.key, 'done')
        stack.pop()
        continue
      }
      frame.next += 1
      const mark = state.get(edge.target)
      if (edge.target === edge.source || mark === 'open') back.add(edge.key)
      else if (mark === undefined) {
        state.set(edge.target, 'open')
        stack.push({ key: edge.target, next: 0 })
      }
    }
  }
  for (const node of nodes) if (node.kind === 'entry') visit(node.key)
  for (const node of nodes) if (!state.has(node.key)) visit(node.key)
  return back
}

/** Keys of the nodes no edge touches (entry markers excepted: they always have start edges). */
export function findIsolated(
  nodes: readonly ModelNode[],
  edges: readonly ModelEdge[],
): Set<string> {
  const touched = new Set<string>()
  for (const edge of edges) {
    touched.add(edge.source)
    touched.add(edge.target)
  }
  const isolated = new Set<string>()
  for (const node of nodes)
    if (node.kind !== 'entry' && !touched.has(node.key)) isolated.add(node.key)
  return isolated
}
