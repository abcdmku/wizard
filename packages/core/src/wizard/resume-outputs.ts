/** Restore item output boundaries without parsing an entire map array as one item. */
import type { CompiledStep, RuntimeBoundary } from '../authoring/compiled'
import { type EachState, eachItem, updateEachItem } from '../machine/each-state'

type Parse = (
  at: string,
  boundary: RuntimeBoundary,
  value: unknown,
) => { readonly value: unknown } | undefined

export function reviveOutput(
  step: CompiledStep,
  at: string,
  value: unknown,
  parse: Parse,
): unknown {
  const boundary = step.kind === 'view' ? step.input : step.output
  if (boundary === undefined) return value
  if (step.each !== undefined && Array.isArray(value)) {
    return value.map((item, index) => {
      const result = parse(`${at}[${index}]`, boundary, item)
      return result === undefined ? item : result.value
    })
  }
  const result = parse(at, boundary, value)
  return result === undefined ? value : result.value
}

export function reviveEach(
  step: CompiledStep,
  at: string,
  each: EachState,
  parse: Parse,
): EachState {
  if (step.output === undefined) return each
  let result = each
  for (let index = 0; index < each.items.length; index++) {
    const item = eachItem(each, index)
    if (item.output === undefined) continue
    const revived = parse(`${at}.items[${index}].output`, step.output, item.output)
    if (revived !== undefined) result = updateEachItem(result, index, { output: revived.value })
  }
  return result
}
