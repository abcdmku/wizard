/** JSON for humans: functions, bigints, cycles and errors do not break it; long output is cut. */
export function stringify(value: unknown, limit = 400): string {
  const seen = new WeakSet<object>()
  let text: string
  try {
    text =
      typeof value === 'string'
        ? value
        : (JSON.stringify(value, (_key, v: unknown) => {
            if (typeof v === 'bigint') return `${v}n`
            if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
            if (v instanceof Error) return `${v.name}: ${v.message}`
            if (typeof v === 'object' && v !== null) {
              if (seen.has(v)) return '[Circular]'
              seen.add(v)
            }
            return v
          }) ?? String(value))
  } catch {
    text = String(value)
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
