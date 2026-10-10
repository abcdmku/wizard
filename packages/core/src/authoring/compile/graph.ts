/**
 * Graph analysis of a flow: dependency cycles (definition problems), navigation cycles and
 * unreachable steps (warnings).
 * @internal
 */

import type { FlowWarning } from './index'

export class StepGraph {
  private readonly nextEdges = new Map<string, Set<string>>()
  private readonly depEdges = new Map<string, readonly string[]>()
  private readonly dynamicSteps = new Set<string>()

  constructor(private readonly ids: readonly string[]) {}

  edges(from: string, to: readonly string[]): void {
    let set = this.nextEdges.get(from)
    if (set === undefined) {
      set = new Set()
      this.nextEdges.set(from, set)
    }
    for (const t of to) set.add(t)
  }
  timeout(from: string, to: string): void {
    this.edges(from, [to])
  }
  dynamic(step: string): void {
    this.dynamicSteps.add(step)
  }
  dependsOn(step: string, deps: readonly string[]): void {
    this.depEdges.set(step, deps)
  }

  /** Simple cycles over `dependsOn` edges (each reported once, in discovery order). */
  dependencyCycles(): readonly (readonly string[])[] {
    return findCycles(this.ids, (id) =>
      (this.depEdges.get(id) ?? []).filter((d) => this.depEdges.has(d) || d === id),
    )
  }

  /** Cycles through static `next` / `timeout.next` edges: allowed (loops), reported as advice. */
  warnNavigationCycles(path: readonly string[], out: FlowWarning[]): void {
    for (const cycle of findCycles(this.ids, (id) => [...(this.nextEdges.get(id) ?? [])])) {
      out.push({
        code: 'NAV_CYCLE',
        message: `navigation cycle: ${cycle.join(' -> ')} (allowed; make sure a guard, a decision or a wait breaks it)`,
        step: cycle[0] as string,
        path,
      })
    }
  }

  /** Steps with no path from `start` (a reachable dynamic-`next` step may reach anything). */
  warnUnreachable(start: readonly string[], path: readonly string[], out: FlowWarning[]): void {
    const reached = new Set<string>()
    const queue = start.filter((s) => this.ids.includes(s))
    for (const s of queue) reached.add(s)
    while (queue.length > 0) {
      const id = queue.shift() as string
      if (this.dynamicSteps.has(id)) {
        for (const t of this.ids) if (!reached.has(t)) reached.add(t)
        break
      }
      for (const t of this.nextEdges.get(id) ?? []) {
        if (!reached.has(t)) {
          reached.add(t)
          queue.push(t)
        }
      }
    }
    for (const id of this.ids) {
      if (reached.has(id)) continue
      const gated = this.depEdges.has(id)
      out.push({
        code: gated ? 'NEVER_ACTIVATES' : 'UNREACHABLE',
        message: gated
          ? `step '${id}' declares dependsOn but has no incoming next/start edge, so it can never activate`
          : `step '${id}' is not reachable from start`,
        step: id,
        path,
      })
    }
  }
}

/** Simple cycles of a directed graph (each reported once, in discovery order). */
function findCycles(
  ids: readonly string[],
  edgesOf: (id: string) => readonly string[],
): readonly (readonly string[])[] {
  const cycles: string[][] = []
  const seen = new Set<string>()
  const visiting: string[] = []
  const onStack = new Set<string>()
  const visit = (id: string): void => {
    if (onStack.has(id)) {
      const cycle = visiting.slice(visiting.indexOf(id))
      cycle.push(id)
      const key = [...cycle].sort().join(' ')
      if (!cycles.some((c) => [...c].sort().join(' ') === key)) cycles.push(cycle)
      return
    }
    if (seen.has(id)) return
    seen.add(id)
    onStack.add(id)
    visiting.push(id)
    for (const next of edgesOf(id)) visit(next)
    visiting.pop()
    onStack.delete(id)
  }
  for (const id of ids) visit(id)
  return cycles
}
