/** `12:04:31.250` in local time. */
export function clock(at: number): string {
  const date = new Date(at)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** `3s`, `4m`, `2h` or `5d`, for a span in milliseconds. */
export function span(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

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

/** `shipping / street` for a step inside a child run. */
export const stepLabel = (path: readonly string[], step: string): string =>
  [...path, step].join(' / ')
