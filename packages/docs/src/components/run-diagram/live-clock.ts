/**
 * The clock and the services of a live diagram. Time moves only when the reader asks, and every
 * service call waits until the reader answers it, so each step can be watched while it runs.
 */
import type { Clock, Scheduler } from '@openwizard/core'
import { show } from './live-format'

/** A clock the reader moves forward one timer at a time. */
export interface ManualClock extends Clock, Scheduler {
  /** Milliseconds until the next timer fires, or undefined when none is armed. */
  nextIn(): number | undefined
  /** Jump to the next timer and fire every timer due by then. */
  advance(): void
}

export function createManualClock(): ManualClock {
  let now = 0
  let handles = 0
  const timers = new Map<number, { readonly fn: () => void; readonly at: number }>()
  // A zero delay means "after this turn", not "when the reader moves time", so it runs for real.
  const immediate = new Map<number, ReturnType<typeof setTimeout>>()
  return {
    now: () => now,
    setTimeout(fn, ms) {
      handles += 1
      const handle = handles
      if (ms <= 0) {
        immediate.set(
          handle,
          setTimeout(() => {
            immediate.delete(handle)
            fn()
          }, 0),
        )
      } else {
        timers.set(handle, { fn, at: now + ms })
      }
      return handle
    },
    clearTimeout(handle) {
      const id = handle as number
      timers.delete(id)
      const real = immediate.get(id)
      if (real !== undefined) clearTimeout(real)
      immediate.delete(id)
    },
    nextIn() {
      let next: number | undefined
      for (const timer of timers.values())
        if (next === undefined || timer.at < next) next = timer.at
      return next === undefined ? undefined : next - now
    },
    advance() {
      let next: number | undefined
      for (const timer of timers.values())
        if (next === undefined || timer.at < next) next = timer.at
      if (next === undefined) return
      now = next
      const due = [...timers]
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at)
      for (const [handle, timer] of due) {
        timers.delete(handle)
        timer.fn()
      }
    },
  }
}

/** One call a step made to a service, waiting for the reader or already answered. */
export interface LiveCall {
  readonly id: number
  readonly name: string
  readonly args: string
  /** What the service returns when the reader lets it succeed. */
  readonly reply: string
  /** The error message when the reader makes it fail, if the example offers that. */
  readonly fail?: string
  readonly state: 'pending' | 'returned' | 'threw'
}

interface OpenCall {
  card: LiveCall
  readonly value: unknown
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface Services {
  /**
   * Wrap a service. Each call waits for the reader: `reply` computes the value it returns, and
   * `fail`, when given, lets the reader make it throw that message instead.
   */
  service<A extends unknown[], R>(
    name: string,
    reply: (...args: A) => R,
    fail?: string,
  ): (...args: A) => Promise<Awaited<R>>
  calls(): readonly LiveCall[]
  answer(id: number, outcome: 'returned' | 'threw'): void
}

export function createServices(onCall: () => void): Services {
  const open = new Map<number, OpenCall>()
  const cards: LiveCall[] = []
  let ids = 0
  return {
    service(name, reply, fail) {
      return (...args) =>
        new Promise((resolve, reject) => {
          ids += 1
          const value = reply(...args)
          // An options object such as `{ idempotencyKey }` is the last argument. It says nothing new.
          const shown = args.filter((arg) => typeof arg !== 'object' || arg === null)
          const card: LiveCall = {
            id: ids,
            name,
            args: shown.map((arg) => show(arg, 24)).join(', '),
            reply: show(value),
            state: 'pending',
            ...(fail === undefined ? {} : { fail }),
          }
          cards.push(card)
          open.set(card.id, {
            card,
            value,
            resolve: resolve as (value: unknown) => void,
            reject,
          })
          onCall()
        })
    },
    calls: () => cards,
    answer(id, outcome) {
      const call = open.get(id)
      if (!call) return
      open.delete(id)
      const index = cards.indexOf(call.card)
      cards[index] = { ...call.card, state: outcome }
      if (outcome === 'returned') call.resolve(call.value)
      else call.reject(new Error(call.card.fail ?? 'failed'))
    },
  }
}
