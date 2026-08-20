/**
 * Timer registry: keyed by the machine's `timerId`, backed by an injectable
 * `Scheduler`. Timers are *state* (see `WizardState.timers`); this registry is
 * only the live mirror that turns `timer.set` / `timer.clear` effects into
 * scheduler calls. Re-setting an id replaces the previous timer.
 *
 * @internal
 */

import type { Clock, Scheduler } from './env'

export interface TimerRegistry {
  /** Arm (or re-arm) `timerId` to fire at absolute time `at` (past → next tick). */
  set(
    timerId: string,
    at: number,
    fire: () => void,
    beforeFire?: () => boolean | Promise<boolean>,
  ): void
  clear(timerId: string): void
  clearAll(): void
  has(timerId: string): boolean
  /** Number of armed timers. */
  size(): number
}

export function createTimerRegistry(env: {
  readonly clock: Clock
  readonly scheduler: Scheduler
}): TimerRegistry {
  const handles = new Map<string, unknown>()

  const clear = (timerId: string): void => {
    const handle = handles.get(timerId)
    if (handle === undefined) return
    handles.delete(timerId)
    env.scheduler.clearTimeout(handle)
  }

  return {
    set(timerId, at, fire, beforeFire) {
      clear(timerId)
      const delay = Math.max(0, at - env.clock.now())
      const handle = env.scheduler.setTimeout(() => {
        // Only fire if this arm is still the current one for the id.
        if (handles.get(timerId) !== handle) return
        if (beforeFire === undefined) {
          handles.delete(timerId)
          fire()
          return
        }
        let allowed: boolean | Promise<boolean>
        try {
          allowed = beforeFire()
        } catch {
          return
        }
        if (isPromiseLike(allowed)) {
          allowed.then(
            (ok) => {
              if (handles.get(timerId) !== handle) return
              handles.delete(timerId)
              if (ok) fire()
            },
            () => {
              if (handles.get(timerId) === handle) handles.delete(timerId)
            },
          )
        } else if (allowed) {
          if (handles.get(timerId) !== handle) return
          handles.delete(timerId)
          fire()
        } else {
          handles.delete(timerId)
        }
      }, delay)
      handles.set(timerId, handle)
    },
    clear,
    clearAll() {
      for (const id of Array.from(handles.keys())) clear(id)
    },
    has: (timerId) => handles.has(timerId),
    size: () => handles.size,
  }
}

function isPromiseLike(value: unknown): value is Promise<boolean> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}
