/**
 * A child wizard's deps: the child step's RAW `deps` mapper (`hooks.childDeps`) runs once and its
 * value is parsed ONCE through the child wizard's `deps` boundary (when it declares one); without a
 * mapper the parent's deps object is passed through unchanged. A throwing mapper, a rejecting or
 * asynchronous boundary is a `SerializedError` for the child step (never thrown into the drain).
 *
 * @internal
 */

import type { CompiledWizard, HookArgs } from '../authoring/compiled'
import type { SerializedError } from '../machine/state'
import { toSerializedError } from './errors'
import { isThenable } from './thenable'

type DepsResolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: SerializedError }

interface ResolveDepsInput {
  readonly step: string
  /** The child step's RAW `deps` mapper, if any. */
  readonly mapper: ((args: HookArgs) => unknown) | undefined
  readonly childDef: CompiledWizard
  /** The parent's deps (passed through when there is no mapper). */
  readonly parentDeps: unknown
  /** A declared parent boundary may intentionally supply undefined. */
  readonly parentDeclaresDeps?: boolean
  /** Builds the mapper's arguments (lazily — only when there is a mapper). */
  readonly args: () => HookArgs
}

export function resolveDeps(input: ResolveDepsInput): DepsResolution {
  const { step, mapper, childDef } = input
  let mapped: unknown
  try {
    mapped = mapper === undefined ? input.parentDeps : mapper(input.args())
  } catch (error) {
    return { ok: false, error: describe(error, `deps mapper of '${step}' threw`) }
  }
  if (isThenable(mapped)) {
    return { ok: false, error: mustBeSync(`deps mapper of '${step}'`) }
  }
  if (
    mapper === undefined &&
    input.parentDeclaresDeps !== true &&
    mapped === undefined &&
    childDef.deps !== undefined
  )
    mapped = {}
  if (childDef.providedDeps !== undefined) {
    const inherited = typeof mapped === 'object' && mapped !== null ? mapped : {}
    mapped = { ...childDef.providedDeps, ...inherited }
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
    return { ok: false, error: mustBeSync(`deps boundary of child wizard '${childDef.name}'`) }
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
          message: `deps of child wizard '${childDef.name}' rejected by boundary${detail.length > 0 ? `: ${detail}` : ''}`,
        },
      }
    }
  }
  return {
    ok: false,
    error: {
      name: 'BoundaryError',
      code: 'BOUNDARY_INVALID_RESULT',
      message: `deps boundary of child wizard '${childDef.name}' returned an invalid result`,
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
