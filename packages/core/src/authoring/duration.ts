/**
 * Duration parsing: `'250ms' | '15s' | '15m' | '2h' | '1d'` or a number of milliseconds.
 *
 * @packageDocumentation
 */

import type { Duration } from './types'

const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/

/**
 * Convert a `Duration` to milliseconds. Numbers pass through (must be finite and ≥ 0);
 * strings need a unit (`ms`, `s`, `m`, `h`, `d`). Throws a `TypeError` for anything else.
 * @public
 */
export function parseDuration(duration: Duration): number {
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError(
        `invalid duration: ${String(duration)} (expected a finite number of ms >= 0)`,
      )
    }
    return duration
  }
  const match = DURATION_RE.exec(String(duration).trim())
  if (match === null) {
    throw new TypeError(
      `invalid duration: '${String(duration)}' (expected e.g. '250ms', '15s', '15m', '2h', '1d')`,
    )
  }
  const [, amount = '0', unit = 'ms'] = match
  return Number(amount) * (UNIT_MS[unit] ?? 1)
}
