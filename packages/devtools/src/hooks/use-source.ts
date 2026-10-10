/**
 * Subscriptions over a `DevtoolsSource`: the latest snapshot (`getSnapshot()` — a wizard's is
 * cached per commit, a Mirror's per frame, so identities are stable) and the live overlay
 * derived from it.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { overlayOf } from '../status'
import type { DevtoolsSource, StepStatusMap } from '../types'

/** Re-renders on every commit / frame of the source; returns its current `getSnapshot()`. */
export function useSourceSnapshot(source: DevtoolsSource): unknown {
  return useSyncExternalStore(
    (listener) => source.subscribe(listener),
    () => source.getSnapshot(),
    () => source.getSnapshot(),
  )
}

/** The live statuses + current view of the source, recomputed once per commit / frame. */
export function useSourceOverlay(source: DevtoolsSource): {
  readonly statuses: StepStatusMap
  readonly current: string | null
} {
  const snapshot = useSourceSnapshot(source)
  return useMemo(() => overlayOf(source, snapshot), [source, snapshot])
}
