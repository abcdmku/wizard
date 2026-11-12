import type { Clock, Scheduler } from '@openwizard/core'

/** Largest delay `setTimeout` accepts. A longer wait is armed again when it fires early. */
const MAX_DELAY = 2_147_483_647

interface Timer {
  readonly at: number
  readonly fn: () => void
  handle: ReturnType<typeof setTimeout>
}

/** The clock and scheduler of a dev run: real time that a person can move forward. */
export interface DevClock extends Clock, Scheduler {
  /** When the earliest timer fires, by this clock. */
  next(): number | undefined
  /** Moves the clock to the earliest timer and fires it. False when no timer is armed. */
  skip(): boolean
  /** Clears every timer. */
  dispose(): void
}

/**
 * A clock that follows the wall clock plus an offset. `skip` adds the time left on the earliest
 * timer to the offset, so a retry delay, a sleep or a timeout fires now and every later
 * deadline stays the same distance away.
 */
export function createDevClock(onChange: () => void = () => {}): DevClock {
  let offset = 0
  let nextId = 1
  const timers = new Map<number, Timer>()
  const now = () => Date.now() + offset

  const arm = (id: number, timer: Omit<Timer, 'handle'>): Timer => {
    const fire = () => {
      if (now() < timer.at) {
        armed.handle = setTimeout(fire, Math.min(timer.at - now(), MAX_DELAY))
        return
      }
      timers.delete(id)
      timer.fn()
      onChange()
    }
    const armed: Timer = {
      ...timer,
      handle: setTimeout(fire, Math.min(Math.max(0, timer.at - now()), MAX_DELAY)),
    }
    return armed
  }

  const earliest = (): [number, Timer] | undefined => {
    let best: [number, Timer] | undefined
    for (const entry of timers) if (best === undefined || entry[1].at < best[1].at) best = entry
    return best
  }

  return {
    now,
    setTimeout(fn, ms) {
      const id = nextId++
      timers.set(id, arm(id, { at: now() + Math.max(0, ms), fn }))
      onChange()
      return id
    },
    clearTimeout(handle) {
      if (typeof handle !== 'number') return
      const timer = timers.get(handle)
      if (timer === undefined) return
      clearTimeout(timer.handle)
      timers.delete(handle)
      onChange()
    },
    next: () => earliest()?.[1].at,
    skip() {
      const first = earliest()
      if (first === undefined) return false
      const [id, timer] = first
      offset += Math.max(0, timer.at - now())
      clearTimeout(timer.handle)
      timers.delete(id)
      // The offset moved, so every other timer is closer than its real timeout says.
      for (const [otherId, other] of timers) {
        clearTimeout(other.handle)
        timers.set(otherId, arm(otherId, other))
      }
      timer.fn()
      onChange()
      return true
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer.handle)
      timers.clear()
    },
  }
}
