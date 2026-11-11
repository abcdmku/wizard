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
import { parseEachChildAddress } from '../interpreter/each-child'

export function canReviveAt(
  def: CompiledFlow,
  root: unknown,
  path: readonly (string | number)[],
): boolean {
  const [head, ...rest] = path
  if (head === 'state') return revivableInState(def, at(root, 'state'), rest)
  if (head === 'children') {
    const [step, ...inner] = rest
    if (typeof step !== 'string') return false
    const address = Object.hasOwn(def.steps, step) ? undefined : parseEachChildAddress(step)
    if (
      address !== undefined &&
      (def.steps[address.step]?.each === undefined ||
        at(root, 'state', 'steps', address.step, 'each', 'keys', address.index) !== address.key)
    ) {
      return false
    }
    const child = def.steps[address?.step ?? step]?.child
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
    def.output === undefined &&
    (head === 'output' ||
      (head === 'terminal' && second === 'output' && at(state, 'terminal', 'status') === 'done'))
  ) {
    let boundary: RuntimeBoundary | undefined
    let latest = -1
    for (const id of def.sinks) {
      if (at(state, 'steps', id, 'status') !== 'done') continue
      const stored = at(state, 'steps', id, 'completedSeq')
      const sequence = typeof stored === 'number' ? stored : 0
      if (sequence < latest) continue
      latest = sequence
      boundary = stepBoundary(def, id)
    }
    return revives(boundary)
  }
  if (
    head === 'steps' &&
    typeof second === 'string' &&
    (third === 'output' || third === 'previousOutput')
  ) {
    return revives(stepBoundary(def, second))
  }
  if (
    head === 'steps' &&
    typeof second === 'string' &&
    def.steps[second]?.each !== undefined &&
    third === 'each' &&
    fourth === 'records' &&
    path[4] === 'root' &&
    itemOutputPath(path.slice(5))
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

/** Follow the sparse each-result trie, stopping at the completed item's output. */
function itemOutputPath(path: readonly (string | number)[]): boolean {
  let offset = 0
  while (path[offset] === 'children') {
    const child = path[offset + 1]
    if (typeof child !== 'number' || !Number.isInteger(child) || child < 0) return false
    offset += 2
  }
  const item = path[offset + 1]
  return (
    path[offset] === 'items' &&
    typeof item === 'number' &&
    Number.isInteger(item) &&
    item >= 0 &&
    path[offset + 2] === 'output'
  )
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
