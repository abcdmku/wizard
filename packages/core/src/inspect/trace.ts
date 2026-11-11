/**
 * Human-readable run traces from `observe()` / `log()` events: `formatTrace(events)` for a
 * support ticket or a test failure, `traceLine(event)` for the columns of a log view.
 *
 * @packageDocumentation
 */

import type { RunEvent, RunEventType } from '@openwizard/core'
import { BOOKKEEPING, brief, narrate } from './narrate'

/**
 * One event of a trace, ready to print: `at` is formatted (see `traceLine`), `step` / `event`
 * are the step and external event it is about (`''` when none), `text` is a plain-English
 * sentence and `detail` the remaining body fields as `key=value`.
 * @public
 */
export interface TraceLine {
  readonly seq: number
  readonly at: string
  readonly path: readonly string[]
  readonly type: RunEventType
  readonly step: string
  readonly event: string
  readonly text: string
  readonly detail: string
}

/**
 * Describe one event. `at` is `+250ms` / `+1.250s` relative to `origin` when given, else
 * `12:34:56.789` for a wall clock or `1234ms` for a virtual (test scheduler) clock.
 * @public
 */
export function traceLine(event: RunEvent, origin?: number): TraceLine {
  const at = (time: number): string => formatAt(time, origin)
  return {
    seq: event.seq,
    at: at(event.at),
    path: event.path,
    type: event.type,
    step: stepOf(event),
    event: 'event' in event && typeof event.event === 'string' ? event.event : '',
    text: narrate(event, at),
    detail: detailOf(event),
  }
}

/**
 * A readable trace, one line per event: time relative to the first event, `[child/path]` for
 * events of child flows, and a sentence (`charge attempt 2 failed: PSP down, will retry`).
 * Machine bookkeeping (timers, navigation phases, `flow.status`, …) is left out unless
 * `all: true`.
 * @public
 */
export function formatTrace(
  events: readonly RunEvent[],
  options: { readonly all?: boolean } = {},
): string {
  const origin = events[0]?.at
  return events
    .filter((event) => options.all === true || !BOOKKEEPING.has(event.type))
    .map((event) => {
      const line = traceLine(event, origin)
      const where = line.path.length > 0 ? `[${line.path.join('/')}] ` : ''
      return `${line.at.padEnd(9)} ${where}${line.text}`
    })
    .join('\n')
}

/** The step an event is about (`step`, else the `to` of a transition), or `''`. */
function stepOf(event: RunEvent): string {
  if ('step' in event && typeof event.step === 'string') return event.step
  if (event.type === 'transition.started' || event.type === 'transition.committed')
    return typeof event.to === 'string' ? event.to : ''
  return ''
}

const ENVELOPE = new Set(['seq', 'at', 'path', 'causedBy', 'durationMs', 'type', 'step'])

/** The body fields that are not the envelope / step, as `key=value` (`reason=…`, `attempt=2`). */
function detailOf(event: RunEvent): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(event)) {
    if (ENVELOPE.has(key) || value === undefined) continue
    parts.push(`${key}=${brief(value)}`)
  }
  return parts.join(' ')
}

const WALL_CLOCK_MIN = 1e12 // ~ 2001-09-09 in ms: below this a clock is a virtual one

function formatAt(at: number, origin: number | undefined): string {
  if (origin !== undefined) {
    const delta = at - origin
    return delta < 1_000 ? `+${delta}ms` : `+${(delta / 1_000).toFixed(3)}s`
  }
  if (at < WALL_CLOCK_MIN) return `${at}ms`
  const d = new Date(at)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
