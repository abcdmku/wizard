/** `12:04:31.250` in local time. */
export function clock(at: number): string {
  const date = new Date(at)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

const UNITS: ReadonlyArray<readonly [number, string]> = [
  [86_400_000, 'd'],
  [3_600_000, 'h'],
  [60_000, 'm'],
  [1_000, 's'],
]

/**
 * `1s`, `5m`, `48h` or `7d`, for a span in milliseconds: the one duration format of the portal,
 * the same rule the graph follows. Whole hours under 72 read as hours, so a 48 hour timeout
 * reads `48h`, as a wizard declares it. Any other whole span reads in its largest whole unit
 * (`7d`, `90m`), and a span that is not whole is rounded to the largest unit that fits.
 */
export function span(ms: number): string {
  const whole = Math.max(0, Math.round(ms))
  if (whole >= 3_600_000 && whole < 259_200_000 && whole % 3_600_000 === 0)
    return `${whole / 3_600_000}h`
  for (const [size, unit] of UNITS)
    if (whole >= size && whole % size === 0) return `${whole / size}${unit}`
  if (whole > 0 && whole < 1000) return `${whole}ms`
  const seconds = Math.round(whole / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 259_200) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

/** `just now`, or `4m ago`, for a time `ms` in the past. */
export const ago = (ms: number): string => (ms < 45_000 ? 'just now' : `${span(ms)} ago`)

/** The last eight characters of a run id, which is enough to tell runs apart in a list. */
export const shortId = (id: string): string => (id.length > 10 ? `…${id.slice(-8)}` : id)

/** Pretty JSON, or a short text for a value JSON cannot hold. */
export function pretty(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** One line of JSON, cut to `max` characters. */
export function brief(value: unknown, max = 90): string {
  const text = JSON.stringify(value) ?? ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * A value as a JavaScript literal for an "In code" block: one line when it is short, indented
 * JSON when it is not. Nothing is cut, so the code stays valid.
 */
export function literal(value: unknown): string {
  const line = JSON.stringify(value)
  if (line === undefined) return 'undefined'
  return line.length <= 60 ? line : JSON.stringify(value, null, 2)
}

/** `120ms`, `1.4s`, or `span` for anything a minute or longer. For a time that was measured. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return span(ms)
}

/** `shipping / street` for a step inside a child run. */
export const stepLabel = (path: readonly string[], step: string): string =>
  [...path, step].join(' / ')

/**
 * Four characters that tell runs apart. A run id is `wiz_<8 random><time>_<n>`, so the first
 * four random characters are both distinct and easy to find in the full id. Other ids keep
 * their last six characters.
 */
export function runTag(id: string): string {
  const random = /^[a-z]+_([a-z0-9]{4})[a-z0-9]*_[a-z0-9]+$/i.exec(id)?.[1]
  return random ?? (id.length > 6 ? id.slice(-6) : id)
}
