/**
 * A child flow's deps: the flow step's RAW `deps` mapper (`hooks.childDeps`) runs once and its
 * value is parsed ONCE through the child flow's `deps` boundary (when it declares one); without a
 * mapper the parent's deps object is passed through unchanged. A throwing mapper, a rejecting or
 * asynchronous boundary is a `SerializedError` for the flow step (never thrown into the drain).
 *
 * @internal
 */

import type { CompiledFlow, HookArgs } from '../authoring/compiled'
import type { SerializedError } from '../machine/state'
import { toSerializedError } from './errors'
import { isThenable } from './thenable'

export type DepsResolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: SerializedError }

export interface ResolveDepsInput {
  readonly step: string
  /** The flow step's RAW `deps` mapper, if any. */
  readonly mapper: ((args: HookArgs) => unknown) | undefined
  readonly childDef: CompiledFlow
  /** The parent's deps (passed through when there is no mapper). */
  readonly parentDeps: unknown
  /** Builds the mapper's arguments (lazily — only when there is a mapper). */
  readonly args: () => HookArgs
}

export function resolveDeps(input: ResolveDepsInput): DepsResolution {
  const { step, mapper, childDef } = input
  if (mapper === undefined) return { ok: true, value: input.parentDeps }
  let mapped: unknown
  try {
    mapped = mapper(input.args())
  } catch (error) {
    return { ok: false, error: describe(error, `deps mapper of '${step}' threw`) }
  }
  if (isThenable(mapped)) {
    return { ok: false, error: mustBeSync(`deps mapper of '${step}'`) }
  }
  const boundary = childDef.deps
  if (boundary === undefined) return { ok: true, value: mapped }
  let result: unknown
  try {
    result = boundary.parse(mapped)
  } catch (error) {
    return { ok: false, error: describe(error, `deps boundary of '${childDef.name}' threw`) }
  }
  if (isThenable(result)) {
    return { ok: false, error: mustBeSync(`deps boundary of child flow '${childDef.name}'`) }
  }
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    if (result.ok === true && 'value' in result) return { ok: true, value: result.value }
    if (result.ok === false) {
      const issues = 'issues' in result && Array.isArray(result.issues) ? result.issues : []
      const detail = issues
        .map((i: unknown) =>
          typeof i === 'object' && i !== null && 'message' in i ? String(i.message) : String(i),
        )
        .join('; ')
      return {
        ok: false,
        error: {
          name: 'BoundaryError',
          code: 'BOUNDARY_REJECTED',
          message: `deps of child flow '${childDef.name}' rejected by boundary${detail.length > 0 ? `: ${detail}` : ''}`,
        },
      }
    }
  }
  return {
    ok: false,
    error: {
      name: 'BoundaryError',
      code: 'BOUNDARY_INVALID_RESULT',
      message: `deps boundary of child flow '${childDef.name}' returned an invalid result`,
    },
  }
}

function mustBeSync(what: string): SerializedError {
  return { name: 'WizardError', code: 'DEFINITION_INVALID', message: `${what} must be synchronous` }
}

/** A thrown value as a `SerializedError`; a non-`Error` value gets `fallback` as context. */
function describe(error: unknown, fallback: string): SerializedError {
  const serialized = toSerializedError(error)
  return error instanceof Error
    ? serialized
    : { ...serialized, message: `${fallback}: ${serialized.message}` }
}
