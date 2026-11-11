/**
 * Small helpers shared by the compiler modules.
 * @internal
 */

import { isRecord } from '../../record'
import type { CompiledStep, RuntimeBoundary } from '../compiled'
import type { AnyStep } from '../types'
import type { JsonValue } from '../types/primitives'

export { isRecord } from '../../record'

export type Rec = Record<string, unknown>
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export function isStepRecord(value: unknown): value is AnyStep {
  if (!isRecord(value)) return false
  const kind = value.kind
  return typeof kind === 'string' && (kind === 'step' || kind === 'view' || kind === 'child')
}

export function describeName(wizard: unknown): string {
  return isRecord(wizard) && typeof wizard.name === 'string' ? wizard.name : '<unnamed>'
}

export const DEFAULT_TTL_MS = 300_000
export const NO_EXPOSE: CompiledStep['expose'] = { input: false, output: false }

export function trustedBoundary(): RuntimeBoundary {
  return { kind: 'trusted', parse: (value) => ({ ok: true, value }) }
}

/** Maximum nesting depth (path length of the deepest child); mirrors the child bridge. */
export const MAX_DEPTH = 8

/** Validate metadata without invoking JSON.stringify or silently dropping values. */
function isJson(value: unknown, visiting = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || visiting.has(value)) return false
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false
  visiting.add(value)
  const valid = (Array.isArray(value) ? value : Object.values(value)).every((v) =>
    isJson(v, visiting),
  )
  visiting.delete(value)
  return valid
}

export function compileProse(
  raw: Rec,
  result: Mutable<Pick<CompiledStep, 'description' | 'meta'>>,
  problem: (message: string) => void,
): void {
  if (raw.description !== undefined) {
    if (typeof raw.description === 'string') result.description = raw.description
    else problem("'description' must be a string")
  }
  if (raw.meta !== undefined) {
    if (isRecord(raw.meta) && isJson(raw.meta))
      result.meta = raw.meta as Readonly<Record<string, JsonValue>>
    else problem("'meta' must be an object of JSON values")
  }
}
