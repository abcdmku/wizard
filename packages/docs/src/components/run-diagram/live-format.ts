/** Short source text for values, command results and trace lines in a live diagram. */
import type { AnyWizardDefinition, RunEvent } from '@openwizard/core'
import { traceLine } from '@openwizard/core/inspect'

/** A value as short source text: `{ by: 'grace' }`. */
export function show(value: unknown, limit = 64): string {
  if (value === undefined) return 'undefined'
  const text =
    typeof value === 'string'
      ? `'${value}'`
      : (JSON.stringify(value) ?? String(value))
          .replace(/"([A-Za-z_$][\w$]*)":/g, '$1: ')
          .replace(/"/g, "'")
          .replace(/,(?=\S)/g, ', ')
          .replace(/^\{(.+)\}$/, '{ $1 }')
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

const SHOWN_KEYS = ['ok', 'status', 'code', 'reason', 'duplicate', 'output'] as const

/** `{ ok: false, code: 'INVALID_INPUT' }` from a command result, or undefined for other values. */
export function describeReturn(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const parts = SHOWN_KEYS.filter((key) => record[key] !== undefined).map(
    (key) => `${key}: ${show(record[key], 72)}`,
  )
  if (parts.length === 0) return undefined
  const text = `{ ${parts.join(', ')} }`
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

/** Validation issues as one line: `email: Invalid email address`. */
export function issueText(
  issues: readonly { readonly message: string; readonly path?: readonly unknown[] }[] | undefined,
): string | undefined {
  if (!issues || issues.length === 0) return undefined
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((part) =>
          typeof part === 'object' && part !== null && 'key' in part
            ? String(part.key)
            : String(part),
        )
        .join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/** Events that repeat what a status change already shows. */
const QUIET =
  /^(transition\.|timer\.(scheduled|cleared)$|step\.(arrived|entered|runStarted|runSucceeded)$)/
/** Trace lines about bookkeeping a reader of a diagram does not need. */
const QUIET_TEXT = / exited -> | child run waiting$| computing idempotency key$/

/** The trace line worth showing for an event, or undefined. */
export function eventLine(event: RunEvent<AnyWizardDefinition>): string | undefined {
  if (QUIET.test(event.type)) return undefined
  const text = traceLine(event).text
  return QUIET_TEXT.test(text) ? undefined : text
}

/** `1 s`, `48 h`: how long a jump forward in time is. */
export function duration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`
  if (ms < 3_600_000) return `${Math.round(ms / 6_000) / 10} min`
  return `${Math.round(ms / 360_000) / 10} h`
}
