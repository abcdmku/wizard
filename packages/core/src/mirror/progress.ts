/** Progress follows only explicitly allowed steps, at the actual child definition depth. */
import type { CompiledWizard } from '../authoring/compiled'
import { isPlainObject } from '../machine/util'

export function exposesProgress(
  projection: { readonly expose: unknown; readonly progress: unknown },
  definition: CompiledWizard,
  path: readonly string[],
  step: string,
): boolean {
  const exposed = projection.expose !== undefined
  let spec: unknown = exposed ? projection.expose : projection.progress
  let def = definition
  for (let position = 0; position < path.length; position += 1) {
    const id = path[position]
    const child = id === undefined || !Object.hasOwn(def.steps, id) ? undefined : def.steps[id]
    if (id === undefined || child?.child === undefined) return false
    if (child.each !== undefined) {
      const index = path[++position]
      if (index === undefined || !/^(0|[1-9]\d*)$/.test(index)) return false
    }
    const entry = exposed ? stepExpose(spec, id) : progressEntry(spec, id)
    spec = isPlainObject(entry) ? entry.child : undefined
    def = child.child
  }
  const entry = exposed ? stepExpose(spec, step) : progressEntry(spec, step)
  return (!exposed && entry === true) || (isPlainObject(entry) && entry.progress === true)
}

function progressEntry(spec: unknown, id: string): unknown {
  return isPlainObject(spec) && Object.hasOwn(spec, id) ? spec[id] : undefined
}

function stepExpose(spec: unknown, id: string): unknown {
  return progressEntry(isPlainObject(spec) ? spec.steps : undefined, id)
}
