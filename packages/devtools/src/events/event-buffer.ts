/**
 * A bounded, subscribable buffer of the events a wizard emits: seeded with `wizard.log()` and
 * fed by `wizard.observe()` (root and child events alike). Appends are coalesced per microtask
 * so a batch of events costs one notification; snapshots are immutable arrays (stable between
 * changes) for `useSyncExternalStore`.
 */

import type { WizardEvent } from '@openwizard/core'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { WizardSource } from '../types'

export const DEFAULT_MAX_EVENTS = 2_000

export interface EventBuffer {
  /** The current events, oldest first (at most `max`). */
  readonly events: readonly WizardEvent[]
  subscribe(listener: () => void): () => void
  /** Replace the contents (the `log()` seed) and notify. */
  seed(events: readonly WizardEvent[]): void
  push(event: WizardEvent): void
}

export function createEventBuffer(max: number): EventBuffer {
  let events: readonly WizardEvent[] = []
  let pending: WizardEvent[] = []
  let scheduled = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const flush = (): void => {
    scheduled = false
    if (pending.length === 0) return
    const next = [...events, ...pending]
    pending = []
    events = next.length > max ? next.slice(next.length - max) : next
    notify()
  }
  return {
    get events() {
      return events
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    seed(seedEvents) {
      events = seedEvents.slice(-max)
      pending = []
      notify()
    },
    push(event) {
      pending.push(event)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(flush)
      }
    },
  }
}

/**
 * The live buffer of a wizard: seeded with `log()` and fed by `observe()` for as long as the
 * component lives (both in the same effect, so no event falls between them). Without a source
 * the buffer stays empty.
 */
export function useEventBuffer(
  source: WizardSource | undefined,
  max: number = DEFAULT_MAX_EVENTS,
): EventBuffer {
  const buffer = useMemo(() => createEventBuffer(max), [max])
  useEffect(() => {
    if (source === undefined) {
      buffer.seed([])
      return
    }
    buffer.seed(source.log())
    return source.observe((event) => buffer.push(event))
  }, [source, buffer])
  return buffer
}

/** The events of a buffer, re-rendering when it changes. */
export function useBufferedEvents(buffer: EventBuffer): readonly WizardEvent[] {
  return useSyncExternalStore(
    (listener) => buffer.subscribe(listener),
    () => buffer.events,
    () => buffer.events,
  )
}
