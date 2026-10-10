/**
 * The replay window of a wizard: a base state plus the root events since it, kept in sync
 * through `observe()`, so `stateAt(seq)` can rebuild any point with `replay(flow, events, {
 * from: base, upTo: seq })`. The base is the state when the window attached (`getState()`), or
 * the initial state when the log still starts at seq 1 and the context input is known — then
 * the whole history is scrubbable. When the window overflows `maxEvents`, the oldest half is
 * folded into the base (the range shrinks, the memory does not grow).
 */

import { type AnyFlow, replay, type Snapshot, type WizardEvent } from '@openwizard/core'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { WizardSource } from '../types'

/**
 * A (typed-erased) wizard state as `replay` returns it.
 * @public
 */
export type ReplayState = Snapshot<AnyFlow>['state']

/**
 * The replay window: a base state and the root events since it (`latest` = the newest seq).
 * @public
 */
export interface ReplayWindow {
  /** The state every replay starts from (its `seq` is the earliest scrubbable point). */
  readonly base: ReplayState
  /** Root events with `seq > base.seq`, ascending. */
  readonly events: readonly WizardEvent[]
  /** The latest seq (`events` last, else `base.seq`). */
  readonly latest: number
}

/**
 * A live replay window over a wizard (`createReplayWindow`): subscribe to it, `attach()` it to
 * start following the wizard, read `window`.
 * @public
 */
export interface ReplayWindowStore {
  readonly window: ReplayWindow
  subscribe(listener: () => void): () => void
  /** Seed from the wizard now and start following it; returns the teardown. */
  attach(): () => void
}

/** The state at `seq` within a window (its base for anything at or before `base.seq`). */
export function stateAt(window: ReplayWindow, flow: AnyFlow, seq: number): ReplayState {
  if (seq <= window.base.seq) return window.base
  return replay(flow, window.events, { from: window.base, upTo: seq })
}

export const DEFAULT_REPLAY_EVENTS = 5_000

/**
 * Create the replay window of a wizard: the base is the wizard's state when `attach()` runs (or
 * the initial state built from `options.context` when the log still starts at seq 1); root
 * events are appended from `observe()`; past `maxEvents` (default 5000) the oldest half is
 * folded into the base. `<Timeline>` creates one itself; `<Devtools>` owns one so the range
 * survives closing the panel.
 * @public
 */
export function createReplayWindow(
  wizard: WizardSource,
  options: { readonly maxEvents?: number; readonly context?: unknown } = {},
): ReplayWindowStore {
  const max = options.maxEvents ?? DEFAULT_REPLAY_EVENTS
  const flow: AnyFlow = wizard.flow
  let window: ReplayWindow = { base: wizard.getState(), events: [], latest: wizard.getState().seq }
  let pending: WizardEvent[] = []
  let scheduled = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const set = (base: ReplayState, events: readonly WizardEvent[]): void => {
    const last = events[events.length - 1]
    window = { base, events, latest: last === undefined ? base.seq : last.seq }
  }
  const flush = (): void => {
    scheduled = false
    if (pending.length === 0) return
    let events = [...window.events, ...pending]
    pending = []
    let base = window.base
    if (events.length > max) {
      // Fold the oldest half into the base: the range shrinks, the memory does not grow.
      const cut = Math.ceil(events.length / 2)
      base = replay(flow, events.slice(0, cut), { from: base })
      events = events.slice(cut)
    }
    set(base, events)
    notify()
  }
  return {
    get window() {
      return window
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach() {
      const current = wizard.getState()
      const log = wizard.log().filter((e) => e.path.length === 0)
      const first = log[0]
      if (current.seq === 0) set(current, [])
      else if (options.context !== undefined && first !== undefined && first.seq === 1) {
        // The whole history is in the log and the context is known: start from the initial state.
        const initial = replay(flow, [], {
          context: options.context,
          instanceId: wizard.id,
          ...(current.correlationId === undefined ? {} : { correlationId: current.correlationId }),
        })
        set(initial, log.slice(-max))
      } else set(current, [])
      pending = []
      notify()
      return wizard.observe((event) => {
        if (event.path.length > 0) return
        pending.push(event)
        if (!scheduled) {
          scheduled = true
          queueMicrotask(flush)
        }
      })
    },
  }
}

export interface UseReplayWindowOptions {
  readonly maxEvents?: number
  readonly context?: unknown
  /** A window created (and attached) by an owner higher up: reused, not attached again. */
  readonly store?: ReplayWindowStore
}

/**
 * The replay window of a wizard, attached for as long as the component lives — or the shared
 * `options.store` of an owner higher up (so the range survives this component). `undefined`
 * without a wizard (a Mirror source).
 */
export function useReplayWindow(
  wizard: WizardSource,
  options?: UseReplayWindowOptions,
): ReplayWindowStore
export function useReplayWindow(
  wizard: WizardSource | undefined,
  options?: UseReplayWindowOptions,
): ReplayWindowStore | undefined
export function useReplayWindow(
  wizard: WizardSource | undefined,
  options: UseReplayWindowOptions = {},
): ReplayWindowStore | undefined {
  const { maxEvents, context, store: shared } = options
  const store = useMemo(() => {
    if (shared !== undefined) return shared
    if (wizard === undefined) return undefined
    return createReplayWindow(wizard, {
      ...(maxEvents === undefined ? {} : { maxEvents }),
      context,
    })
  }, [wizard, maxEvents, context, shared])
  useEffect(() => (shared === undefined ? store?.attach() : undefined), [store, shared])
  return store
}

/** The current window of a store, re-rendering when it changes. */
export function useWindowSnapshot(store: ReplayWindowStore): ReplayWindow {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.window,
    () => store.window,
  )
}
