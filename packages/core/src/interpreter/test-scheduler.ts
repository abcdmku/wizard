/**
 * `createTestScheduler()` — virtual-time `Scheduler` + `Clock` for tests. Exported from
 * `@openwizard/core/testing` (a separate entry): the `Clock` / `Scheduler` types are imported
 * from the main entry by package name, so the testing declarations reference `@openwizard/core`
 * instead of duplicating them.
 *
 * @packageDocumentation
 */

import type { Clock, Scheduler } from '@openwizard/core'

/**
 * Virtual-time scheduler + clock for tests (what `createTestScheduler()` returns): `advance(ms)`
 * fires due timers in order, `flush()` fires everything, `pending()` counts armed timers.
 * @public
 */
export interface TestScheduler extends Scheduler, Clock {
  /** Move virtual time forward, firing due timers in `at` order (then insertion order). */
  advance(ms: number): void
  /** Fire every pending timer regardless of its due time (virtual time jumps to each). */
  flush(): void
  /** Number of armed timers. */
  pending(): number
}

interface VirtualTimer {
  readonly id: number
  readonly at: number
  readonly order: number
  readonly fn: () => void
}

/**
 * Deterministic scheduler + clock for tests: `createWizard(flow, { scheduler })` (it doubles as
 * the clock), then `advance(ms)` / `flush()` to fire retries, wait timeouts and inbox TTLs
 * without real waiting. Timers fire synchronously inside `advance`, so state is committed when
 * it returns (async hooks still need their promises to settle).
 * @public
 */
export function createTestScheduler(options: { readonly now?: number } = {}): TestScheduler {
  let now = options.now ?? 0
  let nextId = 1
  let order = 0
  const timers = new Map<number, VirtualTimer>()

  const takeNext = (limit: number): VirtualTimer | undefined => {
    let best: VirtualTimer | undefined
    for (const t of timers.values()) {
      if (t.at > limit) continue
      if (best === undefined || t.at < best.at || (t.at === best.at && t.order < best.order))
        best = t
    }
    if (best !== undefined) timers.delete(best.id)
    return best
  }

  const runUntil = (limit: number): void => {
    for (;;) {
      const t = takeNext(limit)
      if (t === undefined) break
      if (t.at > now) now = t.at
      t.fn()
    }
  }

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++
      order += 1
      timers.set(id, { id, at: now + Math.max(0, ms), order, fn })
      return id
    },
    clearTimeout(handle) {
      if (typeof handle === 'number') timers.delete(handle)
    },
    advance(ms) {
      const target = now + Math.max(0, ms)
      runUntil(target)
      now = target
    },
    flush() {
      runUntil(Number.POSITIVE_INFINITY)
    },
    pending: () => timers.size,
  }
}
