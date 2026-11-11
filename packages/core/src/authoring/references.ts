/** Resolve object identities before compilation; runtime graphs contain only IDs. @internal */
import { WizardError } from '../errors'
import { isThenable } from '../interpreter/thenable'
import { isRecord } from '../record'

export function resolveReferences(value: unknown): unknown {
  if (!isRecord(value)) return value
  const ids = new Map<unknown, string[]>()
  for (const [id, step] of Object.entries(value)) {
    if (isRecord(step)) ids.set(step, [...(ids.get(step) ?? []), id])
  }
  const invalid = (message: string): never => {
    throw new WizardError('DEFINITION_INVALID', message, { issues: [{ message }] })
  }
  for (const matches of ids.values()) {
    if (matches.length > 1)
      invalid(`A step object belongs to multiple IDs: ${matches.map((id) => `'${id}'`).join(', ')}`)
  }
  const target = (ref: unknown, location: string, dynamic = false): unknown => {
    if (ref === null || ref === undefined || typeof ref === 'string') return ref
    if (Array.isArray(ref)) return ref.map((r) => target(r, location, dynamic))
    const matches = ids.get(ref)
    if (matches?.length !== 1) {
      const message = `${location}: a step reference must belong to this wizard under exactly one ID`
      if (dynamic) throw new TypeError(message)
      return invalid(message)
    }
    return matches[0]
  }
  const resolveResult = (result: unknown, location: string, handler = false): unknown => {
    const resolve = (result: unknown) => {
      if (handler)
        return isRecord(result) && result.next !== undefined
          ? { ...result, next: target(result.next, location, true) }
          : result
      return target(result, location, true)
    }
    return isThenable(result) ? result.then(resolve) : resolve(result)
  }
  const needTarget = (ref: unknown, location: string): unknown => {
    if (Array.isArray(ref)) return ref.map((r) => needTarget(r, location))
    if (typeof ref === 'string')
      return invalid(`${location}: a need requires a step object, not an id string`)
    return target(ref, location)
  }
  return Object.fromEntries(
    Object.entries(value).map(([id, step]) => {
      if (!isRecord(step) || !isRecord(step.config)) return [id, step]
      const config = step.config
      const location = (field: string) => `step '${id}' ${field}`
      const next = config.next
      const deps = config.dependsOn
      const needs = config.needs
      const on = config.on
      return [
        id,
        {
          ...step,
          config: {
            ...config,
            ...(next !== undefined
              ? {
                  next:
                    typeof next === 'function'
                      ? (args: unknown) => resolveResult(next(args), location('next'))
                      : target(next, location('next')),
                }
              : {}),
            ...(config.targets !== undefined
              ? { targets: target(config.targets, location('targets')) }
              : {}),
            ...(config.fallback !== undefined
              ? { fallback: target(config.fallback, location('fallback')) }
              : {}),
            ...(isRecord(config.timeout) && config.timeout.next !== undefined
              ? {
                  timeout: {
                    ...config.timeout,
                    next: target(config.timeout.next, location('timeout.next')),
                  },
                }
              : {}),
            ...(deps !== undefined
              ? {
                  dependsOn: Array.isArray(deps)
                    ? target(deps, location('dependsOn'))
                    : isRecord(deps) && deps.any !== undefined
                      ? { ...deps, any: target(deps.any, location('dependsOn.any')) }
                      : deps,
                }
              : {}),
            ...(isRecord(needs)
              ? {
                  needs: Object.fromEntries(
                    Object.entries(needs).map(([alias, need]) => [
                      alias,
                      isRecord(need) && !ids.has(need) && 'any' in need
                        ? { ...need, any: needTarget(need.any, location(`needs.${alias}.any`)) }
                        : isRecord(need) && !ids.has(need) && 'optional' in need
                          ? {
                              ...need,
                              optional: needTarget(
                                need.optional,
                                location(`needs.${alias}.optional`),
                              ),
                            }
                          : needTarget(need, location(`needs.${alias}`)),
                    ]),
                  ),
                }
              : {}),
            ...(step.kind === 'view' && isRecord(on)
              ? {
                  on: Object.fromEntries(
                    Object.entries(on).map(([event, handler]) => [
                      event,
                      typeof handler === 'function'
                        ? (args: unknown) =>
                            resolveResult(handler(args), location(`on.${event}`), true)
                        : handler,
                    ]),
                  ),
                }
              : {}),
          },
        },
      ]
    }),
  )
}
