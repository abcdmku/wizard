/** Evaluate and freeze the input list before any item starts. */
import type { CompiledStep, HookArgs } from '../authoring/compiled'
import { codedError } from './errors'
import { chain } from './thenable'

export function snapshotEach(step: CompiledStep, args: HookArgs): unknown {
  const config = step.each
  if (config === undefined)
    throw codedError('EachError', 'EACH_INVALID', `step '${step.id}' has no each hook`)
  return chain(config.items(args), (value) => {
    if (!Array.isArray(value))
      throw codedError(
        'EachError',
        'EACH_INVALID',
        `each of step '${step.id}' must return an array`,
      )
    // The persisted value owns its objects too. A caller mutating its source cannot alter a resumed map.
    const items: readonly unknown[] = structuredClone(value)
    const keys: string[] = []
    const seen = new Set<string>()
    for (let index = 0; index < items.length; index++) {
      const key = config.key?.(items[index], index) ?? String(index)
      if (typeof key !== 'string')
        throw codedError(
          'EachError',
          'EACH_INVALID_KEY',
          `key of item ${index} in step '${step.id}' must be a string`,
        )
      if (seen.has(key))
        throw codedError(
          'EachError',
          'EACH_DUPLICATE_KEY',
          `duplicate each key '${key}' in step '${step.id}'`,
        )
      seen.add(key)
      keys.push(key)
    }
    return { items, keys }
  })
}
