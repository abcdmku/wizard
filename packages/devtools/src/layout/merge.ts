/**
 * The edges the graph draws, from the model's edges: two edges between the same pair of steps
 * (a `next` and a `needs`, say) become one line, and labels that repeat what the line already
 * shows are left out, so the layout reserves room only for labels that are drawn.
 *
 * @packageDocumentation
 */

import type { ModelEdge, ModelEdgeKind } from './model'

/** Which kind wins when two edges join the same pair: control flow first, data last. */
const RANK: Readonly<Record<ModelEdgeKind, number>> = {
  next: 0,
  route: 1,
  fallback: 2,
  timeout: 3,
  dynamic: 4,
  needs: 5,
  start: 6,
}

/**
 * The label worth drawing. A dashed `route` line says it routes, and `needs request` on a line
 * that leaves `request` repeats the arrow, so only a renamed or optional need keeps one. A need
 * on any one of several steps is marked once on the step that joins them (`any of`), not on
 * each line into it.
 */
function shownLabel(edge: ModelEdge): string | undefined {
  if (edge.kind === 'route') return undefined
  if (edge.kind !== 'needs' || edge.label === undefined) return edge.label
  if (edge.label.endsWith('(any)')) return undefined
  const sourceId = edge.source.slice(edge.source.lastIndexOf('/') + 1)
  return edge.label === 'needs' || edge.label === `needs ${sourceId}` ? undefined : edge.label
}

/**
 * The label of two edges drawn as one line. When both say something (`timeout 2d` and
 * `needs decision (optional)`) the line says both, data first, so it does not read as the only
 * way from one step to the other.
 */
function joined(win: string | undefined, lose: string | undefined, loseKind: ModelEdgeKind) {
  if (win === undefined) return lose
  if (lose === undefined || loseKind !== 'needs') return win
  return `${lose} · ${win}`
}

function withLabel(edge: ModelEdge, label: string | undefined): ModelEdge {
  const { label: _old, ...rest } = edge
  return label === undefined ? rest : { ...rest, label }
}

/**
 * One edge per pair of steps, each with the label it shows. The kept edge is the control edge
 * (`next`, `route`, `fallback`, `timeout`) when there is one; it takes the data edge's label
 * when it has none, or says both labels when each has one. Edges into one step with the same
 * label say it once.
 */
export function drawnEdges(edges: readonly ModelEdge[]): ModelEdge[] {
  const out: ModelEdge[] = []
  const atPair = new Map<string, number>()
  for (const edge of edges) {
    const pair = `${edge.source}\n${edge.target}`
    const at = atPair.get(pair)
    const label = shownLabel(edge)
    if (at === undefined) {
      atPair.set(pair, out.length)
      out.push(withLabel(edge, label))
      continue
    }
    const kept = out[at]
    if (kept === undefined) continue
    const [win, lose] = RANK[edge.kind] < RANK[kept.kind] ? [edge, kept] : [kept, edge]
    const winLabel = win === edge ? label : kept.label
    const loseLabel = lose === edge ? label : kept.label
    out[at] = withLabel(win, joined(winLabel, loseLabel, lose.kind))
  }
  const said = new Set<string>()
  return out.map((edge) => {
    if (edge.label === undefined) return edge
    const once = `${edge.target}\n${edge.kind}\n${edge.label}`
    if (!said.has(once)) {
      said.add(once)
      return edge
    }
    return withLabel(edge, undefined)
  })
}
