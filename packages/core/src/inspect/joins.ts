/**
 * `EXCLUSIVE_JOIN`: a join with a plain need on alternative branches of one choice. At most one
 * of them runs, so the join is always skipped. Choices are a dynamic `next` with declared
 * `targets` (each target is an alternative) and an event wait with `timeout` (its `next` vs its
 * `timeout.next`). A dynamic `next` without declared targets may reach any step, which keeps the
 * analysis silent (no false positives).
 * @internal
 */

import type { FlowWarning } from '../authoring/compile'
import type { CompiledFlow, CompiledStep } from '../authoring/compiled'
import { declaredTargets } from './node'

const ANY = Symbol('any step')
type Successors = readonly string[] | typeof ANY

export function exclusiveJoinWarnings(
  def: CompiledFlow,
  path: readonly string[],
): readonly FlowWarning[] {
  const joins = def.order.flatMap((id) => {
    const step = def.steps[id]
    if (step === undefined) return []
    const required = Object.values(step.needs ?? {}).flatMap((need) =>
      need.kind === 'all' ? need.steps : [],
    )
    const deps = [...new Set(required)]
    return deps.length > 1 ? [{ id, deps }] : []
  })
  if (joins.length === 0) return []
  const warnings: FlowWarning[] = []
  const warned = new Set<string>()
  for (const choice of def.order) {
    const step = def.steps[choice]
    const alternatives = step === undefined ? [] : alternativesOf(step)
    if (alternatives.length < 2) continue
    const outside = reach(def, def.start, choice)
    // The branch each step belongs to exclusively (reached from exactly one alternative).
    const reaches = alternatives.map((alt) => reach(def, alt, choice))
    const branchOf = (id: string): number | undefined => {
      if (outside.has(id)) return undefined
      const hits = reaches.flatMap((r, i) => (r.has(id) ? [i] : []))
      return hits.length === 1 ? hits[0] : undefined
    }
    for (const { id: join, deps } of joins) {
      if (warned.has(join)) continue
      const exclusive = deps.filter((dep) => branchOf(dep) !== undefined)
      if (new Set(exclusive.map(branchOf)).size < 2) continue
      warned.add(join)
      warnings.push({
        code: 'EXCLUSIVE_JOIN',
        message: `step '${join}' needs all of ${exclusive.map((d) => `'${d}'`).join(', ')}, which are alternative branches of '${choice}' (only one runs); use needs: { result: { any: [...] } } or join after the branches merge`,
        step: join,
        path,
      })
    }
  }
  return warnings
}

/** Entry sets of the alternative branches of a choice step (none for other steps). */
function alternativesOf(step: CompiledStep): readonly (readonly string[])[] {
  const targets = declaredTargets(step)
  if (targets !== undefined) return targets.map((t) => [t])
  if (step.waitTimeout === undefined) return []
  const onEvent = step.next.kind === 'static' ? step.next.targets : []
  return onEvent.length > 0 ? [onEvent, [step.waitTimeout.next]] : []
}

function successors(step: CompiledStep): Successors {
  const out: string[] = []
  if (step.next.kind === 'static') out.push(...step.next.targets)
  if (step.next.kind === 'dynamic') {
    const targets = declaredTargets(step)
    if (targets === undefined) return ANY
    out.push(...targets)
  }
  if (step.waitTimeout !== undefined) out.push(step.waitTimeout.next)
  if (step.fallback !== undefined) out.push(step.fallback)
  return out
}

/** Steps reachable from `from` without passing through `avoid` (`ANY` reaches everything). */
function reach(def: CompiledFlow, from: readonly string[], avoid: string): ReadonlySet<string> {
  const seen = new Set<string>()
  const queue = from.filter((id) => id !== avoid)
  for (const id of queue) seen.add(id)
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    const step = def.steps[id]
    if (step === undefined) continue
    const next = successors(step)
    if (next === ANY) return new Set(def.order)
    for (const to of [...next, ...(def.feeds[id] ?? [])]) {
      if (to === avoid || seen.has(to)) continue
      seen.add(to)
      queue.push(to)
    }
  }
  return seen
}
