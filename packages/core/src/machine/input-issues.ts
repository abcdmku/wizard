/** Retain validation issues outside the fields a shallow input patch replaces. */
import type { Issue } from './state'
import { isPlainObject } from './util'

export function issuesAfterInputPatch(
  issues: readonly Issue[] | undefined,
  patch: unknown,
): readonly Issue[] | undefined {
  if (issues === undefined || !isPlainObject(patch)) return undefined
  const remaining = issues.filter((issue) => {
    if (!Array.isArray(issue?.path)) return true
    const first = issue.path[0]
    if (first === undefined || first === null) return true
    const key = typeof first === 'object' ? first.key : first
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') return true
    return !Object.prototype.propertyIsEnumerable.call(patch, key)
  })
  return remaining.length === issues.length
    ? issues
    : remaining.length === 0
      ? undefined
      : remaining
}
