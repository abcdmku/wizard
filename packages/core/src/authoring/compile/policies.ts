/**
 * Policy fields: durations, the `RetryPolicy` shape (shared by the DSL and the machine) and
 * `dependsOn` specs.
 * @internal
 */

import type { DepsSpec, RetryPolicy } from '../compiled'
import { parseDuration } from '../duration'
import type { Duration } from '../types'
import { isRecord, type Mutable } from './shared'

export function durationMs(
  value: unknown,
  what: string,
  problem: (m: string) => void,
): number | undefined {
  try {
    return parseDuration(value as Duration)
  } catch (error) {
    problem(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Validate a `RetryPolicy` — one shape shared by the DSL and the machine, so nothing is mapped:
 * `retries` a non-negative integer; `backoff` a fixed number of ms or `'exponential'`;
 * `baseMs` / `factor` / `maxBackoffMs` only with `'exponential'` (defaults are applied by the
 * machine: 200 ms / 2 / 30 s); `jitter` a number in 0..1; `when` a predicate. Returns a copy
 * holding only the recognised fields.
 */
export function compileRetry(
  policy: unknown,
  what: string,
  problem: (m: string) => void,
): RetryPolicy | undefined {
  if (!isRecord(policy)) {
    problem(
      `${what} must be { retries, backoff?, baseMs?, factor?, maxBackoffMs?, jitter?, when? }`,
    )
    return undefined
  }
  const { retries, backoff, baseMs, factor, maxBackoffMs, jitter, when } = policy
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0) {
    problem(`${what}.retries must be a non-negative integer`)
    return undefined
  }
  const out: Mutable<RetryPolicy> = { retries }
  if (backoff !== undefined) {
    if (backoff === 'exponential') out.backoff = 'exponential'
    else if (typeof backoff === 'number' && Number.isFinite(backoff) && backoff >= 0)
      out.backoff = backoff
    else problem(`${what}.backoff must be a number of ms >= 0 or 'exponential'`)
  }
  const exponential = backoff === 'exponential'
  const tuning: ReadonlyArray<readonly [key: 'baseMs' | 'factor' | 'maxBackoffMs', v: unknown]> = [
    ['baseMs', baseMs],
    ['factor', factor],
    ['maxBackoffMs', maxBackoffMs],
  ]
  for (const [key, value] of tuning) {
    if (value === undefined) continue
    if (!exponential) {
      problem(`${what}.${key} only applies to backoff: 'exponential'`)
    } else if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < (key === 'factor' ? 1 : 0)
    ) {
      problem(`${what}.${key} must be a number >= ${key === 'factor' ? 1 : 0}`)
    } else out[key] = value
  }
  if (jitter !== undefined) {
    if (typeof jitter === 'number' && jitter >= 0 && jitter <= 1) out.jitter = jitter
    else problem(`${what}.jitter must be a number from 0 to 1`)
  }
  if (when !== undefined) {
    if (typeof when === 'function') out.when = when as (error: unknown) => boolean
    else problem(`${what}.when must be a function (error) => boolean`)
  }
  return out
}

export function toDepsSpec(deps: unknown): DepsSpec | undefined {
  if (Array.isArray(deps) && deps.every((d) => typeof d === 'string'))
    return { all: [...(deps as string[])] }
  if (
    isRecord(deps) &&
    Object.keys(deps).length === 1 &&
    Array.isArray(deps.any) &&
    deps.any.every((d: unknown) => typeof d === 'string')
  ) {
    return { any: [...(deps.any as string[])] }
  }
  return undefined
}
