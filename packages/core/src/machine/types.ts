/**
 * The machine contract: three pure functions + an initial-state builder.
 *
 * `MachineEnv` is the only "ambient" input: the compiled flow, id/clock
 * providers (injectable for deterministic tests) and the run path.
 * Everything else flows through explicit parameters.
 *
 * Determinism rules (see plan §8.1):
 * - `decide` never mutates its input; a no-op decides no events (and the same state).
 * - `apply` is a total fold: any event on any state returns a state.
 * - `plan` receives the POST-batch state and the whole batch.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { Message } from './commands'
import type { Effect } from './effects'
import type { DomainEvent, DomainEventBody } from './events'
import type { StepRecord, WizardState } from './state'

export interface MachineEnv {
  readonly def: CompiledFlow
  /** Path of this run instance ([] = root). */
  readonly path: readonly string[]
  /** Monotonic wall clock (injectable). */
  now(): number
  /** Unique id generator for effect/timer/tx ids (injectable). */
  id(prefix: string): string
  /**
   * The interpreter's step ledger: step writes go in place into one live table across batches and
   * every overwritten record is journaled (see apply/draft.ts). Absent: copy-on-write per batch.
   */
  readonly ledger?: StepLedger
  /** Uniform random number in [0, 1) for retry `jitter` (default `Math.random`; the drawn due time is recorded). */
  random?(): number
  /** Bounds of the remembered `send` event ids (D8); `DEFAULT_EVENT_IDS` when absent. */
  readonly eventIds?: EventIdPolicy
}

/** Journal of in-place step writes: `steps[id]` (a table the ledger owns) changes from `before`. */
export interface StepLedger {
  journal(steps: WizardState['steps'], id: string, before: StepRecord): void
}

/** How long (ms) and how many delivered event ids a run remembers for dedupe. */
export interface EventIdPolicy {
  readonly ttlMs: number
  readonly limit: number
}

/** What `decide` returns: the batch's events and the state they fold to. */
export interface Decision {
  readonly events: readonly DomainEventBody[]
  /** The state after every event (equal to folding the enveloped events with `apply`). */
  readonly state: WizardState
  /** Envelope time of every event of the batch. */
  readonly at: number
}

export interface Machine {
  decide(env: MachineEnv, state: WizardState, msg: Message): Decision
  apply(env: MachineEnv, state: WizardState, event: DomainEvent): WizardState
  plan(env: MachineEnv, state: WizardState, events: readonly DomainEvent[]): readonly Effect[]
}

export interface InitialStateOptions {
  readonly instanceId: string
  /** Context value that already passed the flow's context boundary. */
  readonly context: unknown
  readonly now: number
  readonly epoch?: number
  /** Correlation id stored in `WizardState.correlationId` (`wizard.create(input, { correlationId })`). */
  readonly correlationId?: string
}

export type InitialState = (env: MachineEnv, opts: InitialStateOptions) => WizardState
