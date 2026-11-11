/**
 * Batch accumulator used inside `decide`.
 *
 * `decide` returns a batch of events computed against the PRE-batch state, yet later events in
 * the same batch depend on earlier ones (arrive → schedule → enter → run…). So `decide` folds
 * its own events as it goes: every `emit` appends the body and advances the batch state via
 * `apply` with the envelope the interpreter will assign (`seq = state.seq + 1`, the batch's
 * `at`, `path = env.path`). `apply` only reads `seq`/`at` from the envelope, so the batch
 * state IS the committed state (`replay(log) == state`) and the interpreter adopts it instead of
 * folding again. The fold runs in the batch's draft scope (`inDraft`, apply/draft.ts): a step
 * write never copies the whole run per event.
 *
 * @internal
 */

import { apply } from './apply'
import { inDraft } from './apply/draft'
import type { DomainEventBody } from './events'
import type { WizardState } from './state'
import type { MachineEnv } from './types'

export interface Batch {
  readonly env: MachineEnv
  /** Envelope time of every event of the batch. */
  readonly at: number
  /** State after every event emitted so far. */
  state: WizardState
  readonly events: DomainEventBody[]
  /** The message is an asynchronously settled hook: the next auto-advance restarts the hop guard. Cleared once used. */
  hopBoundary: boolean
}

export function createBatch(env: MachineEnv, state: WizardState, hopBoundary = false): Batch {
  return { env, at: env.now(), state, events: [], hopBoundary }
}

/** Hop count of the next auto-advance: 1 after an async boundary, else one more than the last. */
export function nextHop(b: Batch): number {
  const hops = b.hopBoundary ? 1 : (b.state.nav.hops ?? 0) + 1
  b.hopBoundary = false
  return hops
}

/** Append the body and fold it onto the batch state with its envelope. */
export function emit(b: Batch, body: DomainEventBody): void {
  b.events.push(body)
  const { env, state } = b
  b.state = inDraft(b, env.ledger, () =>
    apply(env, state, { ...body, seq: state.seq + 1, at: b.at, path: env.path }),
  )
}

export function rec(b: Batch, id: string) {
  return b.state.steps[id]
}

export function stepDef(b: Batch, id: string) {
  return b.env.def.steps[id]
}
