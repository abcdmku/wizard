/**
 * Value predicates, the JSON-safety walk and the `describe` helpers shared by the snapshot
 * validation modules.
 *
 * @internal
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

export function describe(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return String(value)
}

function describeProto(proto: object): string {
  const ctor = 'constructor' in proto ? proto.constructor : undefined
  return typeof ctor === 'function' && ctor.name.length > 0 ? ctor.name : 'unknown prototype'
}

/**
 * Reject anything `JSON.stringify` would drop or distort — including `undefined`
 * values: the state contract says optional fields are *absent*, never undefined,
 * so an `undefined` here means the snapshot did not come from a serializer.
 */
export function checkJsonSafe(
  value: unknown,
  path: string,
  reasons: string[],
  seen: WeakSet<object>,
): void {
  switch (typeof value) {
    case 'undefined':
      reasons.push(`${path}: undefined is not serializable (omit the property instead)`)
      return
    case 'function':
      reasons.push(`${path}: functions are not serializable`)
      return
    case 'symbol':
      reasons.push(`${path}: symbols are not serializable`)
      return
    case 'bigint':
      reasons.push(`${path}: bigint is not serializable`)
      return
    case 'number':
      if (!Number.isFinite(value)) reasons.push(`${path}: non-finite numbers are not serializable`)
      return
    case 'object':
      break
    default:
      return
  }
  if (value === null) return
  if (seen.has(value)) {
    reasons.push(`${path}: circular reference`)
    return
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1)
      checkJsonSafe(value[i], `${path}[${i}]`, reasons, seen)
    return
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    reasons.push(`${path}: non-plain object (${describeProto(proto)}) is not serializable`)
    return
  }
  for (const [key, item] of Object.entries(value))
    checkJsonSafe(item, `${path}.${key}`, reasons, seen)
}
