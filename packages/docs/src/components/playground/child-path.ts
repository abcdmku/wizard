/** Resolve public child paths without reading private mapped snapshot addresses. */
import type { AnyWizardDefinition, Run } from '@openwizard/core'
import { inspect, type Manifest } from '@openwizard/core/inspect'

const graphs = new WeakMap<AnyWizardDefinition, Manifest>()

function isRun(value: unknown): value is Run<AnyWizardDefinition> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'wizard' in value &&
    typeof value.wizard === 'object' &&
    value.wizard !== null &&
    'child' in value &&
    typeof value.child === 'function' &&
    'getState' in value &&
    typeof value.getState === 'function' &&
    'getSnapshot' in value &&
    typeof value.getSnapshot === 'function' &&
    'explain' in value &&
    typeof value.explain === 'function'
  )
}

/** Mapped hops consume an owner and numeric index; ordinary hops consume only the owner. */
export function runAt(
  run: Run<AnyWizardDefinition>,
  path: readonly string[],
): Run<AnyWizardDefinition> {
  let target = run
  for (let offset = 0; offset < path.length; offset += 1) {
    const owner = path[offset]
    if (owner === undefined) throw new Error('Missing child step')
    let graph = graphs.get(target.wizard)
    if (graph === undefined) {
      graph = inspect(target.wizard)
      graphs.set(target.wizard, graph)
    }
    const node = graph.nodes.find((node) => node.path.length === 0 && node.id === owner)
    if (node?.each !== undefined) {
      const rawIndex = path[offset + 1]
      if (rawIndex === undefined || !/^(0|[1-9]\d*)$/.test(rawIndex)) {
        throw new Error(`'${owner}' maps over items; choose a waiting child to inspect an item`)
      }
      const index = Number(rawIndex)
      if (!Number.isSafeInteger(index)) throw new Error(`Invalid item index '${rawIndex}'`)
      target = target.child(owner, index)
      offset += 1
    } else {
      // The manifest supplies the ordinary-child fact that AnyWizardDefinition's erased types cannot retain.
      const child: unknown = Reflect.apply(target.child, target, [owner])
      if (!isRun(child)) throw new Error(`'${owner}' did not return a child run`)
      target = child
    }
  }
  return target
}
