/**
 * Error shapes of the interpreter: serialising any thrown value into `{ name, message, code? }`,
 * coded errors, and the boundary result unwrap (`BoundaryRejection` carries the issues so the
 * machine can report a validation failure).
 *
 * @internal
 */

import type { Issue, SerializedError } from '../machine/state'

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
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return code === undefined
      ? { name: error.name, message: error.message }
      : { name: error.name, message: error.message, code }
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String(error.message)
    const name = 'name' in error && typeof error.name === 'string' ? error.name : 'Error'
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return code === undefined ? { name, message } : { name, message, code }
  }
  return { name: 'Error', message: String(error) }
}

export function codedError(name: string, code: string, message: string): Error & { code: string } {
  const error = Object.assign(new Error(message), { code })
  error.name = name
  return error
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

function toIssue(raw: unknown): Issue {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'message' in raw &&
    typeof raw.message === 'string'
  ) {
    const path = 'path' in raw && Array.isArray(raw.path) ? raw.path : undefined
    return path === undefined ? { message: raw.message } : { message: raw.message, path }
  }
  return { message: String(raw) }
}
