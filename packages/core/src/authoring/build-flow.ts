/** Assemble the records returned by the typed wizard authoring callback. @internal */
import { WizardError } from '../errors'
import { isRecord } from '../record'
import { compile } from './compile'
import { resolveReferences } from './references'
import type { AnyFlow } from './types'

const assembly = Symbol('wizard assembly')

/** Public typing belongs to defineWizard; this boundary validates JavaScript callers too. */
export function buildFlow(options: unknown, build: (api: never) => unknown): AnyFlow {
  const invalid = (message: string): never => {
    throw new WizardError('DEFINITION_INVALID', message, { issues: [{ message }] })
  }
  if (!isRecord(options)) return invalid('wizard options must be an object')
  if (typeof build !== 'function') invalid('wizard build must be a function')
  const record = (kind: string, config: unknown, child?: unknown) => {
    if (!isRecord(config)) invalid(`${kind}() requires an object config`)
    return {
      kind,
      config,
      ...(child !== undefined ? { child } : {}),
      '~types': undefined,
      '~links': undefined,
      '~bound': undefined,
      '~exact': undefined,
    }
  }
  const api = {
    step: (config: unknown) => record('step', config),
    view: (config: unknown) => record('view', config),
    flow: (child: unknown, config: unknown) => record('flow', config, child),
    steps: (map: unknown, startOptions?: unknown) => {
      if (!isRecord(map)) invalid('steps() requires an object of steps')
      if (startOptions !== undefined && !isRecord(startOptions))
        invalid('steps() options must be an object')
      return { [assembly]: true, '~steps': map, ...(startOptions as object | undefined) }
    },
  }
  const built = build(api as never)
  if (!isRecord(built) || (built as Record<PropertyKey, unknown>)[assembly] !== true)
    return invalid('wizard build must return steps(map, { start? })')
  const flow = {
    ...options,
    '~types': undefined,
    steps: resolveReferences(built['~steps']),
    ...(built.start !== undefined ? { start: built.start } : {}),
  } as unknown as AnyFlow
  compile(flow)
  return flow
}
