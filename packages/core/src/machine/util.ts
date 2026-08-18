/**
 * Tiny pure helpers shared by the machine modules.
 * @internal
 */

/** Shallow copy without the given keys (needed because optional fields must be absent, not `undefined`). */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const drop: ReadonlySet<PropertyKey> = new Set(keys)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (!drop.has(k)) out[k] = v
  return out as Omit<T, K>
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Normalize a `NextRef` value into a target list (`null`/`undefined` → []). */
export function normalizeTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}
