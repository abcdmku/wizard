/**
 * Row facts of a `WizardEvent` for the log and the timeline: the step / event name it is about,
 * its wizard path, a compact timestamp and a one-line detail.
 *
 * @packageDocumentation
 */

import type { WizardEvent } from '@openwizard/core'

/** The step an event is about (`step`, else the `to` of a transition), or `''`. */
export function eventStep(event: WizardEvent): string {
  const e = event as { readonly step?: string; readonly to?: string | null }
  if (typeof e.step === 'string') return e.step
  if (event.type === 'transition.committed' || event.type === 'transition.started') {
    return typeof e.to === 'string' ? e.to : ''
  }
  return ''
}

/** The external event name (`event.*` events, `flow.started`'s start step is not one). */
export function eventName(event: WizardEvent): string {
  const e = event as { readonly event?: string }
  return typeof e.event === 'string' ? e.event : ''
}

const WALL_CLOCK_MIN = 1e12 // ~ 2001-09-09 in ms: below this a clock is a virtual one

/**
 * `12:34:56.789` for a wall-clock `at`, `+1234ms` for a virtual clock (test scheduler); both
 * relative to `origin` when given (`+0.250s`).
 */
export function formatAt(at: number, origin?: number): string {
  if (origin !== undefined) {
    const delta = at - origin
    return delta < 1_000 ? `+${delta}ms` : `+${(delta / 1_000).toFixed(3)}s`
  }
  if (at < WALL_CLOCK_MIN) return `${at}ms`
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

const ENVELOPE = new Set(['seq', 'at', 'path', 'causedBy', 'durationMs', 'type', 'step'])

/** One line of the body fields that are not the envelope / step (`reason=…`, `attempt=2`, …). */
export function eventDetail(event: WizardEvent): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(event)) {
    if (ENVELOPE.has(key) || value === undefined) continue
    parts.push(`${key}=${brief(value)}`)
  }
  return parts.join(' ')
}

function brief(value: unknown): string {
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 37)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') {
    const v = value as { readonly message?: unknown; readonly type?: unknown }
    if (typeof v.message === 'string') return brief(v.message)
    if (typeof v.type === 'string') return v.type
    return `{${Object.keys(value).length}}`
  }
  return typeof value
}

/** Case-insensitive substring filter over type / step / event name / path. */
export function matchesFilter(event: WizardEvent, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return true
  const hay =
    `${event.type} ${eventStep(event)} ${eventName(event)} ${event.path.join('/')}`.toLowerCase()
  return hay.includes(needle)
}
