/**
 * Graph analysis of a flow: dependency cycles (definition problems), navigation cycles and
 * unreachable steps (warnings).
 * @internal
 */

import type { FlowWarning } from './index'

export class StepGraph {
  private readonly nextEdges = new Map<string, Set<string>>()
  private readonly needEdges = new Map<string, readonly string[]>()

  constructor(private readonly ids: readonly string[]) {}

  edges(from: string, to: readonly string[]): void {
    let set = this.nextEdges.get(from)
    if (set === undefined) {
      set = new Set()
      this.nextEdges.set(from, set)
    }
    for (const t of to) set.add(t)
  }
  needs(step: string, producers: readonly string[]): void {
    this.needEdges.set(step, producers)
  }

  /** Simple cycles over `needs` edges (each reported once, in discovery order). */
  dependencyCycles(): readonly (readonly string[])[] {
    return findCycles(this.ids, (id) =>
      (this.needEdges.get(id) ?? []).filter((d) => this.needEdges.has(d) || d === id),
    )
  }

  /** Cycles through static `next` / `timeout.next` edges: allowed (loops), reported as advice. */
  warnNavigationCycles(path: readonly string[], out: FlowWarning[]): void {
    for (const cycle of findCycles(this.ids, (id) => [...(this.nextEdges.get(id) ?? [])])) {
      out.push({
        code: 'NAV_CYCLE',
        message: `navigation cycle: ${cycle.join(' -> ')} (allowed; make sure a guard, next function, or external event breaks it)`,
        step: cycle[0] as string,
        path,
      })
    }
  }

  /** Steps with no path from start through normal, alternate or data activation edges. */
  warnUnreachable(start: readonly string[], path: readonly string[], out: FlowWarning[]): void {
    const reached = new Set<string>()
    const queue = start.filter((s) => this.ids.includes(s))
    for (const s of queue) reached.add(s)
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index] as string
      for (const t of this.nextEdges.get(id) ?? []) {
        if (!reached.has(t)) {
          reached.add(t)
          queue.push(t)
        }
      }
    }
    for (const id of this.ids) {
      if (reached.has(id)) continue
      out.push({
        code: 'UNREACHABLE',
        message: `step '${id}' is not reachable from start`,
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
