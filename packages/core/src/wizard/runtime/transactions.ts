/**
 * Navigation transactions from the façade's point of view: the outcome of one transaction
 * (`transition.committed` / `rejected` / `failed`, or a disposal) and the tracker that settles
 * the promise of a `next` / `go` / `back` call once its transaction ends — in the command's own
 * batch, later in the same drain, or on dispose.
 *
 * @internal
 */

import type { Effect } from '../../machine/effects'
import type { DomainEvent, TransitionRejectReason } from '../../machine/events'
import type { Issue, SerializedError } from '../../machine/state'

export type TxOutcome =
  | {
      readonly kind: 'committed'
      readonly from: string | null
      readonly to: string
      readonly seq: number
    }
  | {
      readonly kind: 'rejected'
      readonly reason: TransitionRejectReason
      readonly step?: string
      readonly issues?: readonly Issue[]
    }
  | { readonly kind: 'failed'; readonly step: string; readonly error: SerializedError }
  | { readonly kind: 'disposed' }

type MaybePromise<T> = T | Promise<T>

interface TxSlot {
  outcome: TxOutcome | undefined
  readonly waiters: Array<(outcome: TxOutcome) => void>
}

export interface TxTracker {
  /** Record the outcome of `txId` (first one wins) and wake its waiters. */
  settle(txId: string, outcome: TxOutcome): void
  /** Outcome now if known, else a promise (settled by the terminal event, `settle` effect or dispose). */
  await(txId: string): MaybePromise<TxOutcome>
  /** Reserve a slot for a transaction started in `batch` but not finished there, so a terminal event later in the drain is not missed. */
  reserve(batch: readonly DomainEvent[]): void
  /** Settle from a terminal transition event (`transition.committed` / `rejected` / `failed`). */
  track(event: DomainEvent): void
  /** Settle from the machine's `settle` effect (fallback when no terminal event was seen). */
  settleEffect(effect: Extract<Effect, { kind: 'settle' }>, seq: number): void
  /** Every waiter gets `{ kind: 'disposed' }`. */
  disposeAll(): void
}

export function createTxTracker(isDisposed: () => boolean): TxTracker {
  const slots = new Map<string, TxSlot>()
  const settle = (txId: string, outcome: TxOutcome): void => {
    const slot = slots.get(txId)
    if (slot === undefined || slot.outcome !== undefined) return
    slot.outcome = outcome
    if (slot.waiters.length > 0) {
      slots.delete(txId)
      for (const waiter of slot.waiters.splice(0)) waiter(outcome)
    }
  }
  return {
    settle,
    await(txId) {
      if (isDisposed()) return { kind: 'disposed' }
      const slot = slots.get(txId)
      if (slot?.outcome !== undefined) {
        slots.delete(txId)
        return slot.outcome
      }
      return new Promise((resolve) => {
        if (slot === undefined) slots.set(txId, { outcome: undefined, waiters: [resolve] })
        else slot.waiters.push(resolve)
      })
    },
    reserve(batch) {
      for (const event of batch) {
        if (
          event.type === 'transition.started' &&
          terminalIn(batch, event.txId) === undefined &&
          !slots.has(event.txId)
        ) {
          slots.set(event.txId, { outcome: undefined, waiters: [] })
        }
      }
    },
    track(event) {
      if (
        event.type === 'transition.committed' ||
        event.type === 'transition.rejected' ||
        event.type === 'transition.failed'
      ) {
        settle(event.txId, toOutcome(event))
      }
    },
    settleEffect(effect, seq) {
      settle(effect.txId, settleOutcome(effect, seq))
    },
    disposeAll() {
      for (const [txId, slot] of Array.from(slots.entries())) {
        slots.delete(txId)
        for (const waiter of slot.waiters.splice(0)) waiter({ kind: 'disposed' })
      }
    },
  }
}

/** The last terminal event of transaction `txId` in `batch`, if any. */
export function terminalIn(batch: readonly DomainEvent[], txId: string): DomainEvent | undefined {
  let found: DomainEvent | undefined
  for (const event of batch) {
    if (
      (event.type === 'transition.committed' ||
        event.type === 'transition.rejected' ||
        event.type === 'transition.failed') &&
      event.txId === txId
    ) {
      found = event
    }
  }
  return found
}

export function toOutcome(event: DomainEvent): TxOutcome {
  switch (event.type) {
    case 'transition.committed':
      return { kind: 'committed', from: event.from, to: event.to, seq: event.seq }
    case 'transition.rejected':
      return {
        kind: 'rejected',
        reason: event.reason,
        ...(event.step !== undefined ? { step: event.step } : {}),
        ...(event.issues !== undefined ? { issues: event.issues } : {}),
      }
    case 'transition.failed':
      return { kind: 'failed', step: event.step, error: event.error }
    default:
      return { kind: 'disposed' }
  }
}

function settleOutcome(effect: Extract<Effect, { kind: 'settle' }>, seq: number): TxOutcome {
  if (effect.outcome === 'ok') {
    const value = effect.value
    const from =
      typeof value === 'object' &&
      value !== null &&
      'from' in value &&
      typeof value.from === 'string'
        ? value.from
        : null
    const to =
      typeof value === 'object' && value !== null && 'to' in value && typeof value.to === 'string'
        ? value.to
        : ''
    return { kind: 'committed', from, to, seq }
  }
  if (effect.outcome === 'rejected') return { kind: 'rejected', reason: 'not-reachable' }
  return {
    kind: 'failed',
    step: '',
    error: {
      name: 'Error',
      message: typeof effect.error === 'string' ? effect.error : 'transition failed',
    },
  }
}
