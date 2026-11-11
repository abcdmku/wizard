/** Synchronous scope parsing shared by direct projections and Mirror sources. */

import { toRuntimeBoundary } from '../authoring/boundary'
import type { AnyWizardDefinition } from '../authoring/types'
import { describeError, WizardError } from '../errors'
import { isThenable } from '../interpreter/thenable'
import type { Projection } from './define-projection'

const PARSED_SCOPE: unique symbol = Symbol('openwizard.parsed-projection-scope')

interface ParsedScope {
  readonly [PARSED_SCOPE]: {
    readonly projection: object
    readonly value: unknown
  }
}

/** @internal Bind an already parsed scope so Run does not run its boundary again. */
export function bindParsedProjectionScope<Scope>(
  projection: Pick<Projection<AnyWizardDefinition, unknown, Scope>, 'scope'>,
  value: Scope,
): Scope {
  const bound: ParsedScope = {
    [PARSED_SCOPE]: { projection, value },
  }
  return bound as ParsedScope & Scope
}

export function parseProjectionScope<Scope>(
  projection: Pick<Projection<AnyWizardDefinition, unknown, Scope>, 'scope'>,
  supplied: boolean,
  value: Scope | undefined,
): Scope | undefined {
  const scopeBoundary = projection.scope
  if (scopeBoundary === undefined) {
    if (supplied) {
      throw new WizardError('DEFINITION_INVALID', 'an unscoped projection does not accept scope')
    }
    return undefined
  }
  if (!supplied) {
    throw new WizardError('DEFINITION_INVALID', 'a scoped projection requires scope')
  }
  const bound = parsedScopeOf(value)
  if (bound !== undefined && bound.projection === projection) return bound.value as Scope

  let parsed: ReturnType<ReturnType<typeof toRuntimeBoundary>['parse']>
  try {
    parsed = toRuntimeBoundary(scopeBoundary).parse(value)
  } catch (error) {
    throw new WizardError(
      'BOUNDARY_REJECTED',
      `projection scope rejected by its boundary: ${describeError(error)}`,
      { cause: error },
    )
  }
  if (isThenable(parsed)) {
    throw new WizardError(
      'SYNC_VIOLATION',
      'projection scope boundary must be synchronous because project() is synchronous',
    )
  }
  if (!parsed.ok) {
    throw new WizardError(
      'BOUNDARY_REJECTED',
      `projection scope rejected by its boundary: ${parsed.issues.map((issue) => issue.message).join('; ')}`,
      { issues: parsed.issues },
    )
  }
  return parsed.value as Scope
}

function parsedScopeOf(value: unknown): ParsedScope[typeof PARSED_SCOPE] | undefined {
  if (typeof value !== 'object' || value === null || !(PARSED_SCOPE in value)) return undefined
  const bound = (value as ParsedScope)[PARSED_SCOPE]
  return typeof bound === 'object' && bound !== null ? bound : undefined
}
