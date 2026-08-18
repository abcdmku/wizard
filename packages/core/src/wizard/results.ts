/**
 * Result types returned by `Wizard` methods and `dispatch()`.
 *
 * One contract: results are values; the machine never throws for data
 * problems (see plan §8.2). `WizardError` is reserved for programmer errors.
 *
 * @public
 */

import type { WizardErrorCode } from '../errors'
import type { TransitionRejectReason } from '../machine/events'
import type { Issue, SerializedError } from '../machine/state'

/**
 * Result of `dispatch()` and of every non-navigation command method (`start`, `setInput`, `retry`, …).
 *
 * @public
 */
export type CommandResult =
  | { readonly ok: true; readonly seq: number }
  | {
      readonly ok: false
      readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'
      readonly message: string
      readonly step?: string
      readonly issues?: readonly Issue[]
    }

/**
 * Result of the navigation methods `next()`, `back()` and `go()`.
 *
 * @public
 */
export type NavResult =
  | { readonly ok: true; readonly from: string | null; readonly to: string; readonly seq: number }
  | {
      readonly ok: false
      readonly reason: TransitionRejectReason
      readonly code: WizardErrorCode
      readonly message: string
      readonly step?: string
      readonly issues?: readonly Issue[]
    }
  /**
   * The transition was accepted but a hook threw (`transition.failed`), or the
   * wizard was disposed while the transition was in flight (`code: 'DISPOSED'`).
   */
  | {
      readonly ok: false
      readonly reason: 'failed'
      readonly code: WizardErrorCode | 'HOOK_FAILED'
      readonly message: string
      readonly step?: string
      readonly error?: SerializedError
    }

/**
 * Result of `send(event, payload)`: delivered/buffered, rejected by the event boundary
 * (`code: 'BOUNDARY_REJECTED'`, with the boundary's `issues`), or dropped — nothing was waiting
 * for the event and it was not buffered (`code: 'NOT_ACTIVE'`), the machine refused it
 * (`FLOW_TERMINAL` / `FLOW_NOT_STARTED` / `FLOW_COMPENSATING`, …) or the wizard was disposed
 * (`DISPOSED`). Every `{ ok: false }` result carries `code` + `message`, like `CommandResult`;
 * `dispatch({ type: 'send' })` returns the same `code` as a `CommandResult`.
 *
 * @public
 */
export type SendResult =
  | {
      readonly ok: true
      readonly delivered: readonly string[]
      readonly buffered: boolean
      readonly seq: number
    }
  | {
      readonly ok: false
      readonly reason: 'rejected'
      readonly code: 'BOUNDARY_REJECTED'
      readonly message: string
      readonly issues: readonly Issue[]
    }
  | {
      readonly ok: false
      readonly reason: 'dropped'
      readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'
      readonly message: string
    }
