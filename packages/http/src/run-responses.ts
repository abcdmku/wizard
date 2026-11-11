import type { CommandResult, SendResult } from '@openwizard/core'
import { failure, json } from './http-response'
import { isUnrecorded, type Unrecorded } from './run-handle'

/**
 * `200 { ok, data: { seq } }`, or the run's refusal: 422 with issues, 409 otherwise. An
 * unrecorded refusal passes through for `idempotent` to release.
 */
export function commandResponse(result: CommandResult | Unrecorded): Response | Unrecorded {
  if (isUnrecorded(result)) return result
  if (result.ok) return json(200, { ok: true, data: { seq: result.seq } })
  return failure(result.issues === undefined ? 409 : 422, result.code, result.message, {
    ...(result.issues === undefined ? {} : { issues: result.issues }),
  })
}

/**
 * `200 { ok, data: EventAccepted }`, 422 for a payload the event boundary rejected, 409 for a
 * drop. An unrecorded refusal passes through for `idempotent` to release.
 */
export function sendResponse(result: SendResult | Unrecorded): Response | Unrecorded {
  if (isUnrecorded(result)) return result
  if (!result.ok) {
    return result.reason === 'rejected'
      ? failure(422, result.code, result.message, { issues: result.issues })
      : failure(409, result.code, result.message)
  }
  return json(200, {
    ok: true,
    data: {
      delivered: result.delivered,
      buffered: result.buffered,
      seq: result.seq,
      ...('duplicate' in result && result.duplicate === true ? { duplicate: true } : {}),
    },
  })
}

/** An unrecorded refusal: 422 for a reused id, otherwise a retryable 409/503. */
export function unrecordedResponse(result: Unrecorded): Response {
  return failure(
    result.status,
    result.code,
    result.message,
    {},
    result.status === 422 ? undefined : { 'retry-after': '1' },
  )
}
