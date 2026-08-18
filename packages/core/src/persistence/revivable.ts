/**
 * Which snapshot locations may hold a `toJSON()` object (a `Date`, …) at persist time: exactly
 * the ones a schema / parse boundary re-parses on resume, so the JSON form written to the store
 * comes back as the rich value (`z.coerce.date()`), or resume rejects the snapshot loudly
 * (`SNAPSHOT_INCOMPATIBLE`) instead of quietly handing the flow a string where its types say
 * `Date`. Everywhere else the state must be plain JSON.
 *
 * | location                          | reviving boundary                                  |
 * |-----------------------------------|----------------------------------------------------|
 * | `state.context`                   | the flow's `context` boundary                      |
 * | `state.steps.<id>.output`         | the step's `output` (views: `input`) boundary      |
 * | `state.steps.<id>.previousOutput` | same boundary (v0.2: the output `invalidate` moved) |
 * | `state.saga.stack[i].output`      | that entry's step, same rule                       |
 * | `state.inbox[i].payload`          | `events[<entry.event>]`                            |
 * | `children.<id>.…`                 | the same table against the child flow              |
 *
 * `guard` / `assert` / `trusted` boundaries validate or trust a value but never transform it, so
 * they cannot revive anything: only `standard` (a Standard Schema) and `parse` count.
 *
 * @internal
 */

import type { CompiledFlow, RuntimeBoundary } from '../authoring/compiled'

export function canReviveAt(
  def: CompiledFlow,
  root: unknown,
  path: readonly (string | number)[],
): boolean {
  const [head, ...rest] = path
  if (head === 'state') return revivableInState(def, at(root, 'state'), rest)
  if (head === 'children') {
    const [step, ...inner] = rest
    if (typeof step !== 'string' || !Object.hasOwn(def.steps, step)) return false
    const child = def.steps[step]?.child
    return child === undefined ? false : canReviveAt(child, at(root, 'children', step), inner)
  }
  return false
}

function revivableInState(
  def: CompiledFlow,
  state: unknown,
  path: readonly (string | number)[],
): boolean {
  const [head, second, third, fourth] = path
  if (head === 'context') return revives(def.context)
  if (
    head === 'steps' &&
    typeof second === 'string' &&
    (third === 'output' || third === 'previousOutput')
  ) {
    return revives(stepBoundary(def, second))
  }
  if (head === 'saga' && second === 'stack' && typeof third === 'number' && fourth === 'output') {
    const step = at(state, 'saga', 'stack', third, 'step')
    return typeof step === 'string' && revives(stepBoundary(def, step))
  }
  if (head === 'inbox' && typeof second === 'number' && third === 'payload') {
    const event = at(state, 'inbox', second, 'event')
    return (
      typeof event === 'string' && Object.hasOwn(def.events, event) && revives(def.events[event])
    )
  }
  return false
}

/** The boundary that re-parses a step's stored `output` on resume (views: their `input`). */
function stepBoundary(def: CompiledFlow, step: string): RuntimeBoundary | undefined {
  if (!Object.hasOwn(def.steps, step)) return undefined
  const stepDef = def.steps[step]
  if (stepDef === undefined) return undefined
  return stepDef.kind === 'view' ? stepDef.input : stepDef.output
}

function revives(boundary: RuntimeBoundary | undefined): boolean {
  return boundary !== undefined && (boundary.kind === 'standard' || boundary.kind === 'parse')
}

/** `root[a][b]…`, `undefined` when the path leaves plain data. */
function at(root: unknown, ...keys: readonly (string | number)[]): unknown {
  let cursor: unknown = root
  for (const key of keys) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    if (Array.isArray(cursor)) {
      if (typeof key !== 'number') return undefined
      cursor = cursor[key]
    } else {
      if (!Object.hasOwn(cursor, key)) return undefined
      cursor = (cursor as Record<string, unknown>)[String(key)]
    }
  }
  return cursor
}
