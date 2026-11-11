/**
 * Optimistic drafts of a Mirror: every `setInput` (also one wrapped in `child` commands) is
 * kept as a pending patch and merged over the last frame's state, so a controlled input shows
 * what the user typed before the server answers. A patch is dropped when its command fails, or
 * once a frame at or past the seq its ack reported has been applied (the server state then
 * contains it). Plus `share`, the structural sharing that keeps unchanged slices identical.
 *
 * @internal
 */

import type { Command } from '@openwizard/core'
import { issuesAfterInputPatch } from '../machine/input-issues'
import { isPlainObject, setOwn } from '../machine/util'

/** One pending `setInput`: the child `path` (`[]` = root), the view, the patch, the ack seq once known. */
export interface PendingDraft {
  readonly path: readonly string[]
  readonly step: string
  readonly patch: unknown
  ackSeq?: number
}

/** The `setInput` inside `command` (unwrapping `child` commands), or `undefined`. */
export function draftOf(command: Command): PendingDraft | undefined {
  let current: Command = command
  const path: string[] = []
  while (current.type === 'child') {
    path.push(...current.path)
    current = current.command as Command
  }
  if (current.type !== 'setInput') return undefined
  return { path, step: current.step, patch: current.patch }
}

/**
 * `state` with every pending patch shallow-merged (in send order) into
 * `steps[step].input` of the slice at its path. Only step records that look like projected
 * steps (`id` equal to the key) are touched; anything else (a `select` projection of another
 * shape, a child that is not exposed) is left as it is.
 */
export function overlayDrafts(state: unknown, drafts: Iterable<PendingDraft>): unknown {
  let out = state
  for (const draft of drafts) out = patchAt(out, [...draft.path], draft)
  return out
}

function patchAt(slice: unknown, path: string[], draft: PendingDraft): unknown {
  if (!isPlainObject(slice) || !isPlainObject(slice.steps)) return slice
  const steps = slice.steps
  const [head, ...rest] = path
  const id = head ?? draft.step
  const record = Object.hasOwn(steps, id) ? steps[id] : undefined
  if (!isPlainObject(record) || record.id !== id) return slice
  let next: Record<string, unknown>
  if (head === undefined) {
    if (!isPlainObject(draft.patch)) return slice
    const input = isPlainObject(record.input) ? record.input : {}
    next = { ...record, input: { ...input, ...draft.patch } }
    if (Array.isArray(record.issues)) {
      const issues = issuesAfterInputPatch(record.issues, draft.patch)
      if (issues === undefined) delete next.issues
      else next.issues = issues
    }
  } else {
    let child: unknown
    if (Array.isArray(record.child)) {
      const [selector, ...childPath] = rest
      if (selector === undefined || !/^(0|[1-9]\d*)$/.test(selector)) return slice
      const index = Number(selector)
      if (!Number.isSafeInteger(index) || index >= record.child.length) return slice
      const before = record.child[index]
      const after = patchAt(before, childPath, draft)
      if (before === after) return slice
      const items = [...record.child]
      items[index] = after
      child = items
    } else child = patchAt(record.child, rest, draft)
    if (child === record.child) return slice
    next = { ...record, child }
  }
  const nextSteps: Record<string, unknown> = { ...steps }
  setOwn(nextSteps, id, next)
  return { ...slice, steps: nextSteps }
}

/**
 * Return `next` with every sub-tree that deep-equals the corresponding sub-tree of `prev`
 * replaced by the `prev` reference (plain objects and arrays only). `prev` itself is returned
 * when the two are deep-equal. Keys are always written as own properties, so a step id like
 * `__proto__` survives (a plain assignment would set the prototype instead).
 */
export function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length
    const out = next.map((item, i) => {
      const shared = share(prev[i], item)
      if (shared !== prev[i]) same = false
      return shared
    })
    return same ? prev : out
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next)
    let same = keys.length === Object.keys(prev).length
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const shared = share(Object.hasOwn(prev, key) ? prev[key] : undefined, next[key])
      if (!Object.hasOwn(prev, key) || shared !== prev[key]) same = false
      setOwn(out, key, shared)
    }
    return same ? prev : out
  }
  return next
}
