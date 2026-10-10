/**
 * Batch accumulator used inside `decide`.
 *
 * `decide` must return a batch of events computed against the PRE-batch state,
 * yet later events in the same batch depend on earlier ones (arrive → schedule
 * → enter → run…). So `decide` folds its own events as it goes: every `emit`
 * appends the body and advances a local state via `apply` with a temporary
 * envelope (`seq = state.seq + 1`, `at = env.now()`, `path = env.path`).
 * The interpreter assigns the real envelopes when it commits the batch; because
 * `apply` only reads `seq`/`at` from the envelope, the temporary fold and the
 * real fold produce identical states (`replay(log) == state`).
 *
 * @internal
 */

import { apply } from './apply'
import type { DomainEventBody } from './events'
import type { WizardState } from './state'
import type { MachineEnv } from './types'

export interface Batch {
  readonly env: MachineEnv
  /** State after every event emitted so far. */
  state: WizardState
  readonly events: DomainEventBody[]
}

export function createBatch(env: MachineEnv, state: WizardState): Batch {
  return { env, state, events: [] }
}

/** Append the body and fold it onto the batch state with a temporary envelope. */
export function emit(b: Batch, body: DomainEventBody): void {
  b.events.push(body)
  const { env, state } = b
  b.state = apply(env, state, { ...body, seq: state.seq + 1, at: env.now(), path: env.path })
}

export function rec(b: Batch, id: string) {
  return b.state.steps[id]
}

export function stepDef(b: Batch, id: string) {
  return b.env.def.steps[id]
}
