/** Split an id such as `payment.captured` or `order-flow` into its alphanumeric words. */
function words(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean)
}

/** `payment.captured` → `PaymentCaptured`. Empty input yields `fallback`. */
export function pascalCase(value: string, fallback = ''): string {
  const joined = words(value)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join('')
  return joined.length === 0 ? fallback : joined
}

/** `payment.captured` → `paymentCaptured`. Empty input yields `fallback`. */
export function camelCase(value: string, fallback = ''): string {
  const pascal = pascalCase(value)
  return pascal.length === 0 ? fallback : `${pascal[0]?.toLowerCase() ?? ''}${pascal.slice(1)}`
}

/** `/api/:runId` → `/api/{runId}`. */
export function toOpenAPIPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

/** Validate a route prefix and strip its trailing slash. `/` becomes the empty prefix. */
export function normalizePrefix(path: string, label: string): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes(':')) {
    throw new TypeError(`${label} must be an absolute pathname without parameters, query, or hash`)
  }
  if (path === '/') return ''
  return path.endsWith('/') ? path.slice(0, -1) : path
}
