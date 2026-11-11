/** Resolve normal, alternate and data edges. @internal */
import type { NeedSpec, NextRef } from '../compiled'
import { asHook } from './hooks'
import { isRecord, type Rec } from './shared'
import type { Problem, StepBuild, StepCtx, StepHooks } from './steps'

function idsOf(
  value: unknown,
  field: string,
  problem: Problem,
  ids: ReadonlySet<string>,
): string[] | undefined {
  if (!Array.isArray(value) || value.some((ref) => typeof ref !== 'string')) {
    problem(`${field} must be an array of step references`)
    return undefined
  }
  if (value.length === 0) problem(`${field} must contain at least one step`)
  for (const ref of value as string[]) {
    if (!ids.has(ref)) problem(`${field}: unknown step '${ref}'`)
  }
  return [...new Set(value as string[])]
}

export function compileEdges(
  id: string,
  c: Rec,
  step: StepBuild,
  hooks: StepHooks,
  problem: Problem,
  sc: StepCtx,
): void {
  const targets = c.targets === undefined ? undefined : idsOf(c.targets, 'targets', problem, sc.ids)
  if (typeof c.next === 'function') {
    if (c.targets === undefined) problem("a function 'next' must declare 'targets'")
    step.next = { kind: 'dynamic', ...(targets !== undefined ? { targets } : {}) }
    hooks.next = asHook<NextRef>(c.next as (args: never) => unknown)
    if (targets !== undefined) sc.graph.edges(id, targets)
  } else if (typeof c.next === 'string' || Array.isArray(c.next)) {
    const next = idsOf(typeof c.next === 'string' ? [c.next] : c.next, 'next', problem, sc.ids)
    if (next !== undefined) {
      if (targets !== undefined && next.some((to) => !targets.includes(to)))
        problem("'next' must reference only declared 'targets'")
      step.next = { kind: 'static', targets: next }
      sc.graph.edges(id, next)
    }
  } else if (c.next !== undefined && c.next !== null) {
    problem("'next' must be a step reference, an array of references, null, or a function")
  }
  if (targets !== undefined && typeof c.next !== 'function')
    problem("'targets' requires a function 'next'")

  if (c.needs !== undefined) {
    if (!isRecord(c.needs)) problem("'needs' must be an object of step references")
    else {
      const needs: Record<string, NeedSpec> = Object.create(null)
      const producers: string[] = []
      if (Object.keys(c.needs).length === 0) problem("'needs' must contain at least one dependency")
      for (const [alias, ref] of Object.entries(c.needs)) {
        let mode: NeedSpec['kind'] = 'all'
        let value: unknown = ref
        if (isRecord(ref)) {
          if ('any' in ref && !('optional' in ref) && Object.keys(ref).length === 1) {
            mode = 'any'
            value = ref.any
          } else if ('optional' in ref && !('any' in ref) && Object.keys(ref).length === 1) {
            mode = 'optional'
            value = [ref.optional]
          } else {
            problem(
              `needs.${alias} must be a step reference, { any: references }, or { optional: reference }`,
            )
            continue
          }
        } else value = [ref]
        const list = idsOf(value, `needs.${alias}${mode === 'any' ? '.any' : ''}`, problem, sc.ids)
        if (list === undefined) continue
        needs[alias] = { kind: mode, steps: list }
        producers.push(...list)
        for (const producer of list) sc.graph.edges(producer, [id])
      }
      step.needs = needs
      if (producers.length > 0) sc.graph.needs(id, producers)
    }
  }
  if (c.fallback !== undefined) {
    if (typeof c.fallback !== 'string') problem("'fallback' must be a step reference")
    else {
      if (!sc.ids.has(c.fallback)) problem(`fallback: unknown step '${c.fallback}'`)
      step.fallback = c.fallback
      sc.graph.edges(id, [c.fallback])
    }
  }
}
