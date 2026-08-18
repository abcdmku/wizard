/**
 * Envelopes (`seq` / `at` / `path` / `causedBy` / `durationMs`) for a decided batch, and the
 * best-effort causal link of a planned effect.
 *
 * @internal
 */

import type { Message } from '../machine/commands'
import type { Effect } from '../machine/effects'
import type { DomainEvent, DomainEventBody } from '../machine/events'

export interface EnvelopeInput {
  /** The state's seq BEFORE the batch (the first event gets `seq + 1`). */
  readonly seq: number
  readonly at: number
  readonly path: readonly string[]
  readonly msg: Message
  readonly causedBy: number | undefined
}

/** Assign envelopes to a batch. */
export function envelope(bodies: readonly DomainEventBody[], input: EnvelopeInput): DomainEvent[] {
  const { at, path, msg, causedBy } = input
  const durationMs = msg.type === 'res.ok' || msg.type === 'res.err' ? msg.durationMs : undefined
  let seq = input.seq
  return bodies.map((body) => {
    seq += 1
    // Two body fields collide with the envelope (see the contract note in the report):
    // - `at` on `timer.scheduled` / `step.retryScheduled` is a *payload* (due time) → body wins;
    // - `path` on `child.started` is informational → the envelope's routing path wins.
    return {
      seq,
      at,
      ...(causedBy !== undefined ? { causedBy } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...body,
      path,
    }
  })
}

/**
 * Best-effort causal link for a planned effect: the last event of the batch
 * that names the same step / timer, else the batch's last event.
 */
export function causeOf(effect: Effect, batch: readonly DomainEvent[]): number | undefined {
  const last = batch[batch.length - 1]
  if (last === undefined) return undefined
  switch (effect.kind) {
    case 'call':
    case 'child.create':
    case 'child.send':
    case 'child.dispose': {
      for (let i = batch.length - 1; i >= 0; i -= 1) {
        const event = batch[i]
        if (event !== undefined && 'step' in event && event.step === effect.step) return event.seq
      }
      return last.seq
    }
    case 'timer.set':
    case 'timer.clear': {
      for (let i = batch.length - 1; i >= 0; i -= 1) {
        const event = batch[i]
        if (event !== undefined && 'timerId' in event && event.timerId === effect.timerId)
          return event.seq
      }
      return last.seq
    }
    default:
      return last.seq
  }
}
