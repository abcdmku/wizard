/**
 * Error shapes of the interpreter: serialising any thrown value into `{ name, message, code? }`,
 * coded errors, and the boundary result unwrap (`BoundaryRejection` carries the issues so the
 * machine can report a validation failure).
 *
 * @internal
 */

import { toIssue } from '../authoring/boundary'
import { isRunFailure } from '../authoring/run-adapter'
import type { RunFailureKind } from '../machine/commands'
import type { Issue, SerializedError } from '../machine/state'
import { firstNonJson } from '../wizard/json'

/** Thrown internally when a boundary rejects a value; carries the issues. */
export class BoundaryRejection extends Error {
  readonly issues: readonly Issue[]
  constructor(issues: readonly Issue[], what: string) {
    super(`${what} rejected by boundary: ${issues.map((i) => i.message).join('; ')}`)
    this.name = 'BoundaryRejection'
    this.issues = issues
  }
}

/** Serialize any thrown value into `{ name, message, code? }` — never a stack. */
export function toSerializedError(error: unknown): SerializedError {
  try {
    let name = 'Error'
    let message: string
    let code: string | undefined
    if (error instanceof Error) {
      const rawCode = 'code' in error ? error.code : undefined
      code = typeof rawCode === 'string' ? rawCode : undefined
      name = String(error.name)
      message = String(error.message)
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      message = String(error.message)
      const rawName = 'name' in error ? error.name : undefined
      const rawCode = 'code' in error ? error.code : undefined
      if (typeof rawName === 'string') name = rawName
      if (typeof rawCode === 'string') code = rawCode
    } else message = String(error)
    return code === undefined ? { name, message } : { name, message, code }
  } catch {
    return { name: 'Error', message: 'Error' }
  }
}

export function codedError(name: string, code: string, message: string): Error & { code: string } {
  const error = Object.assign(new Error(message), { code })
  error.name = name
  return error
}

/** Invalid error data must fail before it can enter the event log or a snapshot. */
export function invalidErrorData(
  step: string,
  source: 'mapError' | 'run adapter',
  value: unknown,
): Error | undefined {
  let detail: string
  try {
    const bad = firstNonJson(value)
    if (bad === undefined) return undefined
    detail = ` at ${bad.path || '<root>'}: ${bad.problem}`
  } catch {
    detail = ': its properties could not be read'
  }
  return codedError(
    source === 'mapError' ? 'MapErrorDataError' : 'RunErrorDataError',
    source === 'mapError' ? 'INVALID_MAP_ERROR' : 'INVALID_RUN_ERROR',
    `${source} of step '${step}' returned a non-JSON value${detail}`,
  )
}

interface AdapterFailure {
  readonly kind: RunFailureKind
  readonly error: unknown
  readonly data?: unknown
  readonly invalid?: true
}

/** Read a failure envelope once so a getter cannot swap its checked data before serialization. */
export function normalizeRunFailure(step: string, value: unknown): AdapterFailure | undefined {
  try {
    if (!isRunFailure(value)) return undefined
    const { kind, error, data } = value
    const invalid = data === undefined ? undefined : invalidErrorData(step, 'run adapter', data)
    if (invalid !== undefined) return { kind: 'defect', error: invalid, invalid: true }
    return { kind, error, ...(data !== undefined ? { data } : {}) }
  } catch {
    return {
      kind: 'defect',
      invalid: true,
      error: codedError(
        'RunErrorDataError',
        'INVALID_RUN_ERROR',
        `run adapter of step '${step}' returned an unreadable failure envelope`,
      ),
    }
  }
}

/** The value of an `ok` boundary result; a rejection throws `BoundaryRejection`, anything else a coded error. */
export function unwrapBoundary(result: unknown, what: string): unknown {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    if (result.ok === true && 'value' in result) return result.value
    if (result.ok === false && 'issues' in result && Array.isArray(result.issues)) {
      throw new BoundaryRejection(result.issues.map(toIssue), what)
    }
  }
  throw codedError(
    'BoundaryError',
    'BOUNDARY_INVALID_RESULT',
    `${what} boundary returned an invalid result`,
  )
}
