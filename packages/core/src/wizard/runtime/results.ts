/**
 * Result mapping: a processed batch (or a transaction outcome) → the value the public method
 * returns (`CommandResult` / `NavResult` / `SendResult`, plan §8.2). Pure functions.
 *
 * @internal
 */

import type { WizardErrorCode } from '../../errors'
import type { DomainEvent, TransitionRejectReason } from '../../machine/events'
import type { SerializedError } from '../../machine/state'
import type { CommandResult, NavResult, SendResult } from '../results'
import type { TxOutcome } from './transactions'

/** What the interpreter did with one enqueued command. */
export interface Processed {
  readonly batch: readonly DomainEvent[]
  readonly seq: number
  readonly disposed: boolean
}

type ResultCode = WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'

const RESULT_CODES: ReadonlySet<string> = new Set<ResultCode>([
  'UNKNOWN_STEP',
  'UNKNOWN_EVENT',
  'NOT_A_VIEW',
  'NOT_A_TASK',
  'NOT_A_FLOW_STEP',
  'NOT_ACTIVE',
  'NOT_REACHABLE',
  'NAV_BUSY',
  'NO_TARGET',
  'NO_HISTORY',
  'INVALID_INPUT',
  'BOUNDARY_REJECTED',
  'GUARD_BLOCKED',
  'FLOW_TERMINAL',
  'FLOW_NOT_STARTED',
  'INVALID_COMMAND',
  'SYNC_VIOLATION',
  'SNAPSHOT_INCOMPATIBLE',
  'NESTING_CYCLE',
  'NESTING_TOO_DEEP',
  'DEFINITION_INVALID',
  'DISPOSED',
  'STALE',
  'FLOW_COMPENSATING',
])

function isResultCode(code: string): code is ResultCode {
  return RESULT_CODES.has(code)
}

/** A `WizardErrorCode` carried by a serialized hook error (e.g. `SYNC_VIOLATION`), if recognized. */
function wizardCodeOf(error: SerializedError): WizardErrorCode | undefined {
  const code = error.code
  if (code === undefined || !isResultCode(code) || code === 'STALE' || code === 'FLOW_COMPENSATING')
    return undefined
  return code
}

type RejectedResult = Extract<CommandResult, { ok: false }>

/** The first `command.rejected` of a batch as a `{ ok: false }` result. */
export function findRejected(batch: readonly DomainEvent[]): RejectedResult | undefined {
  for (const event of batch) {
    if (event.type !== 'command.rejected') continue
    const step =
      'step' in event.command && typeof event.command.step === 'string'
        ? event.command.step
        : event.command.type === 'child'
          ? event.command.path[0]
          : undefined
    return {
      ok: false,
      code: isResultCode(event.code) ? event.code : 'INVALID_COMMAND',
      message: event.reason,
      ...(step !== undefined ? { step } : {}),
    }
  }
  return undefined
}

export function commandResult(processed: Processed): CommandResult {
  if (processed.disposed) return { ok: false, code: 'DISPOSED', message: 'wizard disposed' }
  return findRejected(processed.batch) ?? { ok: true, seq: processed.seq }
}

/** A `command.rejected` on a navigation command as a `NavResult` (`STALE` / compensating → `INVALID_COMMAND`). */
export function rejectedNavResult(rejected: RejectedResult): NavResult {
  return {
    ok: false,
    reason: reasonForCode(rejected.code),
    code:
      rejected.code === 'FLOW_COMPENSATING' || rejected.code === 'STALE'
        ? 'INVALID_COMMAND'
        : rejected.code,
    message: rejected.message,
    ...(rejected.step !== undefined ? { step: rejected.step } : {}),
    ...(rejected.issues !== undefined ? { issues: rejected.issues } : {}),
  }
}

/**
 * The command's OWN transaction in its batch: the first non-auto `transition.started` (a
 * cursor-rule / auto-advance transaction may commit in the same batch, right after it).
 */
export function ownTxId(batch: readonly DomainEvent[]): string | undefined {
  let txId: string | undefined
  for (const event of batch) {
    if (event.type !== 'transition.started') continue
    if (event.cause !== 'auto') return event.txId
    txId ??= event.txId
  }
  return txId
}

const NAV_CODE: Readonly<Record<TransitionRejectReason, WizardErrorCode>> = {
  'nav-busy': 'NAV_BUSY',
  'not-a-view': 'NOT_A_VIEW',
  'not-active': 'NOT_ACTIVE',
  'not-reachable': 'NOT_REACHABLE',
  validation: 'INVALID_INPUT',
  'guard-canExit': 'GUARD_BLOCKED',
  'guard-canEnter': 'GUARD_BLOCKED',
  'no-target': 'NO_TARGET',
  'no-history': 'NO_HISTORY',
  'flow-terminal': 'FLOW_TERMINAL',
  'flow-not-started': 'FLOW_NOT_STARTED',
  'flow-compensating': 'INVALID_COMMAND',
  resumed: 'INVALID_COMMAND',
  'auto-advance-loop': 'INVALID_COMMAND',
}

const CODE_REASON: Readonly<Partial<Record<ResultCode, TransitionRejectReason>>> = {
  NAV_BUSY: 'nav-busy',
  NOT_A_VIEW: 'not-a-view',
  NOT_ACTIVE: 'not-active',
  NOT_REACHABLE: 'not-reachable',
  INVALID_INPUT: 'validation',
  GUARD_BLOCKED: 'guard-canEnter',
  NO_TARGET: 'no-target',
  NO_HISTORY: 'no-history',
  FLOW_TERMINAL: 'flow-terminal',
  FLOW_NOT_STARTED: 'flow-not-started',
  FLOW_COMPENSATING: 'flow-compensating',
  UNKNOWN_STEP: 'not-a-view',
}

function reasonForCode(code: ResultCode): TransitionRejectReason {
  return CODE_REASON[code] ?? 'not-reachable'
}

export function toNavResult(outcome: TxOutcome): NavResult {
  switch (outcome.kind) {
    case 'committed':
      return { ok: true, from: outcome.from, to: outcome.to, seq: outcome.seq }
    case 'rejected':
      return {
        ok: false,
        reason: outcome.reason,
        code: NAV_CODE[outcome.reason],
        message: `transition rejected: ${outcome.reason}`,
        ...(outcome.step !== undefined ? { step: outcome.step } : {}),
        ...(outcome.issues !== undefined ? { issues: outcome.issues } : {}),
      }
    case 'failed':
      return {
        ok: false,
        reason: 'failed',
        // A recognized WizardError code on the hook error (SYNC_VIOLATION, UNKNOWN_STEP, ...) survives.
        code: wizardCodeOf(outcome.error) ?? 'HOOK_FAILED',
        message: outcome.error.message,
        ...(outcome.step.length > 0 ? { step: outcome.step } : {}),
        error: outcome.error,
      }
    case 'disposed':
      return { ok: false, reason: 'failed', code: 'DISPOSED', message: 'wizard disposed' }
  }
}

export function navToCommandResult(result: NavResult): CommandResult {
  if (result.ok) return { ok: true, seq: result.seq }
  return {
    ok: false,
    code: result.code === 'HOOK_FAILED' ? 'INVALID_COMMAND' : result.code,
    message: result.message,
    ...(result.step !== undefined ? { step: result.step } : {}),
    ...('issues' in result && result.issues !== undefined ? { issues: result.issues } : {}),
  }
}

export const DROPPED_DISPOSED: SendResult = {
  ok: false,
  reason: 'dropped',
  code: 'DISPOSED',
  message: 'wizard disposed',
}

/** The `SendResult` of a routed event: who handled it (steps, buffer, flow-level handler) or why not. */
export function sendResult(event: string, processed: Processed): SendResult {
  if (processed.disposed) return DROPPED_DISPOSED
  const rejected = findRejected(processed.batch)
  if (rejected !== undefined) {
    return { ok: false, reason: 'dropped', code: rejected.code, message: rejected.message }
  }
  const delivered: string[] = []
  let buffered = false
  let flowHandled = false
  let dropped: string | undefined
  for (const ev of processed.batch) {
    if (ev.type === 'event.delivered' && ev.event === event) delivered.push(ev.to)
    else if (ev.type === 'event.buffered' && ev.event === event) buffered = true
    else if (ev.type === 'event.flowDelivered' && ev.event === event) flowHandled = true
    else if (ev.type === 'event.dropped' && ev.event === event) dropped = ev.reason
  }
  // v0.2: a flow-level handler counts as handled (`delivered` lists step ids only).
  if (delivered.length > 0 || buffered || flowHandled)
    return { ok: true, delivered, buffered, seq: processed.seq }
  return {
    ok: false,
    reason: 'dropped',
    code: 'NOT_ACTIVE',
    message: dropped ?? 'event was not routed',
  }
}

export function sendToCommandResult(result: SendResult): CommandResult {
  if (result.ok) return { ok: true, seq: result.seq }
  if (result.reason === 'rejected') {
    return { ok: false, code: result.code, message: result.message, issues: result.issues }
  }
  return { ok: false, code: result.code, message: result.message }
}
