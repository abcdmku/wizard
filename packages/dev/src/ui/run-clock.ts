import { useEffect, useMemo, useState } from 'react'
import type { RunDetail } from '../wire'

/** A run's clock as the page reads it: the time now, and how far it runs ahead of the wall clock. */
export interface RunClock {
  /** The time on the run's clock, which ticks along with the wall clock. */
  readonly now: number
  /** How far the run's clock is ahead of the wall clock, rounded to its unit, in ms. 0 when not. */
  readonly ahead: number
}

/**
 * The run's clock, read again every `every` ms. Skipping a timer moves a run's clock ahead of
 * the wall clock, and the run's times (`enteredAt`, event times, deadlines) are on that clock, so
 * every relative time on the run page compares against this and not against `Date.now()`.
 */
export function useRunClock(run: RunDetail, every = 1000): RunClock {
  // `run.now` was read when the server sent the run, so the gap to the wall clock then is the skew.
  const skew = useMemo(() => run.now - Date.now(), [run])
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setWall(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  // Rounded to the unit it reads in, so a skipped 5 minute timer reads `5m` and not `299s`.
  const unit = skew >= 3_600_000 ? 3_600_000 : skew >= 60_000 ? 60_000 : 1000
  const ahead = Math.round(skew / unit) * unit
  return { now: Math.max(run.now, wall + skew), ahead: ahead >= 1000 ? ahead : 0 }
}
