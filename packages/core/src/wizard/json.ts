/**
 * `firstNonJson(value, options?)` — the one JSON-safety walk shared by the command decoders
 * (`parseCommand` payloads, with hard limits so untrusted input can never exhaust the stack or
 * the heap) and by the persistence driver (a snapshot is checked BEFORE every store write, so
 * a `Map` / class instance / `bigint` / `NaN` / function / `undefined` array slot is reported
 * with its exact path instead of being silently distorted by `JSON.stringify`).
 *
 * Iterative (explicit stack, no recursion), cycle-aware (ancestors only — a value referenced
 * twice is fine, JSON duplicates it), plain-object-only (`Object.prototype` or `null` prototype).
 * `reviveAt` lets the persistence driver accept an object with a `toJSON()` method (a `Date`, …)
 * exactly where a boundary re-parses its JSON form on resume — its `toJSON()` result is then
 * checked in its place, like `JSON.stringify` would serialize it.
 *
 * @internal
 */

/** Limits and allowances; every field is optional (absent = strict and unlimited). */
export interface JsonCheckOptions {
  /** Maximum nesting depth (the root is depth 0). */
  readonly maxDepth?: number
  /** Maximum number of values visited (objects, arrays and primitives). */
  readonly maxNodes?: number
  /** Maximum length of any string (UTF-16 code units). */
  readonly maxStringLength?: number
  /**
   * `true`: an `undefined` object PROPERTY is tolerated (`JSON.stringify` omits it — the
   * persisted object simply lacks the key). `undefined` array slots are always rejected (they
   * become `null`). Default `false` (commands must survive a round trip unchanged).
   */
  readonly allowUndefinedProperties?: boolean
  /**
   * Called for a non-plain object that has a `toJSON()` method (`Date`, …) with its path
   * segments from the root; `true` accepts it (its `toJSON()` result is checked instead).
   * Default: such objects are rejected like any other non-plain object.
   */
  readonly reviveAt?: (path: readonly (string | number)[]) => boolean
}

/** Where and why a value is not JSON: `path` is `''` for the root, `.a[0].b` style below it. */
export interface JsonProblem {
  readonly path: string
  readonly segments: readonly (string | number)[]
  readonly problem: string
}

interface Frame {
  readonly value: unknown
  readonly path: string
  readonly segments: readonly (string | number)[]
  readonly depth: number
  /** Property (not array slot) → `undefined` may be tolerated. */
  readonly property: boolean
  /** Already replaced by its `toJSON()` result (never revive twice). */
  readonly revived?: boolean
}

/**
 * The first reason `value` would not survive `JSON.parse(JSON.stringify(value))` unchanged
 * (`undefined` when it would). Never throws (a throwing `toJSON()` is itself a problem).
 */
export function firstNonJson(
  value: unknown,
  options: JsonCheckOptions = {},
): JsonProblem | undefined {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY
  const maxNodes = options.maxNodes ?? Number.POSITIVE_INFINITY
  const maxString = options.maxStringLength ?? Number.POSITIVE_INFINITY
  const allowUndefined = options.allowUndefinedProperties === true
  const stack: (Frame | { readonly leave: object })[] = [
    { value, path: '', segments: [], depth: 0, property: false },
  ]
  const ancestors = new Set<object>()
  let nodes = 0
  const problem = (frame: Frame, text: string): JsonProblem => ({
    path: frame.path,
    segments: frame.segments,
    problem: text,
  })
  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) break
    if ('leave' in frame) {
      ancestors.delete(frame.leave)
      continue
    }
    nodes += 1
    if (nodes > maxNodes) return problem(frame, `has more than ${maxNodes} values`)
    if (frame.depth > maxDepth) return problem(frame, `nests deeper than ${maxDepth} levels`)
    const v = frame.value
    switch (typeof v) {
      case 'string':
        if (v.length > maxString) {
          return problem(frame, `is a string longer than ${maxString} characters`)
        }
        continue
      case 'boolean':
        continue
      case 'number':
        if (!Number.isFinite(v)) return problem(frame, 'is not a finite number')
        continue
      case 'undefined':
        if (allowUndefined && frame.property) continue
        return problem(frame, 'is undefined')
      case 'object':
        break
      default:
        return problem(frame, `is a ${typeof v}`)
    }
    if (v === null) continue
    if (ancestors.has(v)) return problem(frame, 'is circular')
    if (Array.isArray(v)) {
      ancestors.add(v)
      stack.push({ leave: v })
      for (let i = v.length - 1; i >= 0; i -= 1) {
        stack.push({
          value: v[i],
          path: `${frame.path}[${i}]`,
          segments: [...frame.segments, i],
          depth: frame.depth + 1,
          property: false,
        })
      }
      continue
    }
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) {
      const toJSON = (v as { readonly toJSON?: unknown }).toJSON
      if (
        typeof toJSON === 'function' &&
        frame.revived !== true &&
        options.reviveAt?.(frame.segments) === true
      ) {
        let json: unknown
        try {
          json = toJSON.call(v, String(frame.segments.at(-1) ?? ''))
        } catch {
          return problem(frame, `is a ${describeProto(proto)} whose toJSON() threw`)
        }
        stack.push({ ...frame, value: json, revived: true })
        continue
      }
      return problem(frame, `is a ${describeProto(proto)} (not a plain object)`)
    }
    ancestors.add(v)
    stack.push({ leave: v })
    const keys = Object.keys(v)
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i] as string
      stack.push({
        value: (v as Record<string, unknown>)[key],
        path: `${frame.path}.${key}`,
        segments: [...frame.segments, key],
        depth: frame.depth + 1,
        property: true,
      })
    }
  }
  return undefined
}

function describeProto(proto: object): string {
  const ctor = Object.hasOwn(proto, 'constructor')
    ? (proto as { readonly constructor?: unknown }).constructor
    : undefined
  return typeof ctor === 'function' && ctor.name.length > 0 ? ctor.name : 'non-plain object'
}
