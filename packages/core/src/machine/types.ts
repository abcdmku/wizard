/**
 * The machine contract: three pure functions + an initial-state builder.
 *
 * `MachineEnv` is the only "ambient" input: the compiled flow, id/clock
 * providers (injectable for deterministic tests) and the wizard path.
 * Everything else flows through explicit parameters.
 *
 * Determinism rules (see plan §8.1):
 * - `decide` never mutates; returns [] for a no-op.
 * - `apply` is a total fold: any event on any state returns a state.
 * - `plan` receives the POST-batch state and the whole batch.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { Message } from './commands'
import type { Effect } from './effects'
import type { DomainEvent, DomainEventBody } from './events'
import type { WizardState } from './state'

export interface MachineEnv {
  readonly def: CompiledFlow
  /** Path of this wizard instance ([] = root). */
  readonly path: readonly string[]
  /** Monotonic wall clock (injectable). */
  now(): number
  /** Unique id generator for effect/timer/tx ids (injectable). */
  id(prefix: string): string
}

export interface Machine {
  decide(env: MachineEnv, state: WizardState, msg: Message): readonly DomainEventBody[]
  apply(env: MachineEnv, state: WizardState, event: DomainEvent): WizardState
  plan(env: MachineEnv, state: WizardState, events: readonly DomainEvent[]): readonly Effect[]
}

export interface InitialStateOptions {
  readonly instanceId: string
  /** Context value that already passed the flow's context boundary. */
  readonly context: unknown
  readonly now: number
  readonly epoch?: number
  /** v0.2: correlation id stored in `WizardState.correlationId` (`createWizard(flow, { correlationId })`). */
  readonly correlationId?: string
}

export type InitialState = (env: MachineEnv, opts: InitialStateOptions) => WizardState
