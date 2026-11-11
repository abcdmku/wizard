/** Resolve a child's real step id, including the encoded address of a mapped child. */
import type { CompiledWizard } from '../authoring/compiled'
import { parseEachChildAddress } from '../interpreter/each-child'

export function projectionChild(
  def: CompiledWizard,
  address: string,
):
  | {
      readonly id: string
      readonly definition: CompiledWizard
      readonly path: readonly string[]
      readonly index?: number
    }
  | undefined {
  const direct = Object.hasOwn(def.steps, address) ? def.steps[address] : undefined
  if (direct !== undefined) {
    return direct.child === undefined
      ? undefined
      : { id: address, definition: direct.child, path: [address] }
  }
  const mapped = parseEachChildAddress(address)
  if (mapped === undefined || !Object.hasOwn(def.steps, mapped.step)) return undefined
  const step = def.steps[mapped.step]
  if (step?.each === undefined || step.child === undefined) return undefined
  return {
    id: mapped.step,
    definition: step.child,
    path: [mapped.step, String(mapped.index)],
    index: mapped.index,
  }
}
