/**
 * `WizardError` — the ONE error type of the public API, thrown only for programmer errors
 * (plan §8.2): a disposed wizard, an invalid definition, an incompatible snapshot, an undeclared
 * event name, `child()` of a non-flow / inactive step, a boundary rejecting `context` / `deps` at
 * the door. Data problems never throw: machine-level rejections are events
 * (`command.rejected`, `transition.rejected`, …) and the façade returns them as values
 * (`{ ok: false, code, message, issues? }` — `CommandResult` / `NavResult` / `SendResult`),
 * with the same stable `WizardErrorCode` vocabulary.
 *
 * @public
 */

import type { Issue } from './machine/state'

/**
 * Stable error codes carried by `WizardError` and by `{ ok: false }` results.
 *
 * @public
 */
export type WizardErrorCode =
  | 'UNKNOWN_STEP'
  | 'UNKNOWN_EVENT'
  | 'NOT_A_VIEW'
  | 'NOT_A_TASK'
  | 'NOT_A_FLOW_STEP'
  | 'NOT_ACTIVE'
  | 'NOT_REACHABLE'
  | 'NAV_BUSY'
  | 'NO_TARGET'
  | 'NO_HISTORY'
  | 'INVALID_INPUT'
  | 'BOUNDARY_REJECTED'
  | 'GUARD_BLOCKED'
  | 'FLOW_TERMINAL'
  | 'FLOW_NOT_STARTED'
  | 'INVALID_COMMAND'
  | 'SYNC_VIOLATION'
  | 'SNAPSHOT_INCOMPATIBLE'
  | 'SNAPSHOT_NOT_SERIALIZABLE'
  | 'NESTING_CYCLE'
  | 'NESTING_TOO_DEEP'
  | 'DEFINITION_INVALID'
  | 'DISPOSED'

/**
 * Error thrown for programmer errors (misuse of the API): unknown event names,
 * incompatible snapshots, invalid definitions, disposed wizards. Data problems
 * (validation, rejected commands) are returned as `{ ok: false }` results instead.
 *
 * @public
 */
export class WizardError extends Error {
  readonly code: WizardErrorCode
  readonly step?: string
  readonly issues?: readonly Issue[]

  constructor(
    code: WizardErrorCode,
    message: string,
    options: { step?: string; issues?: readonly Issue[]; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'WizardError'
    this.code = code
    if (options.step !== undefined) this.step = options.step
    if (options.issues !== undefined) this.issues = options.issues
  }
}

/**
 * Type guard for `WizardError`.
 *
 * @public
 */
export function isWizardError(value: unknown): value is WizardError {
  return value instanceof WizardError
}

/** The message of a thrown value (`Error.message`, else its string form). @internal */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
