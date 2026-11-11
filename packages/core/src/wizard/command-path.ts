/** Resolve child paths and count wizard edges rather than item selector segments. */
import type { CompiledWizard } from '../authoring/compiled'
import type { Issue } from '../machine/state'

export function resolveCommandPath(
  def: CompiledWizard | undefined,
  segments: readonly string[],
  path: readonly PropertyKey[],
  issues: Issue[],
  checkIds: boolean,
): { def: CompiledWizard | undefined; levels: number } | undefined {
  let target = def
  let levels = 0
  for (let index = 0; index < segments.length; index++) {
    levels++
    if (target === undefined) continue
    const segment = segments[index]
    const step =
      segment === undefined || !Object.hasOwn(target.steps, segment)
        ? undefined
        : target.steps[segment]
    if (step === undefined || step.kind !== 'child' || step.child === undefined) {
      if (!checkIds) {
        target = undefined
        continue
      }
      issues.push({
        message:
          step === undefined ? `unknown step '${segment}'` : `'${segment}' is not a child step`,
        path: [...path, 'path', index],
      })
      return undefined
    }
    if (step.each !== undefined) {
      if (segments[index + 1] === undefined) {
        issues.push({
          message: `mapped child '${segment}' requires an item key or index`,
          path: [...path, 'path', index + 1],
        })
        return undefined
      }
      index++
    }
    target = step.child
  }
  return { def: target, levels }
}
