/** Stored error, terminal, inbox, and timer records used by `WizardState`. @internal */

import type { Command, TimerFired } from './commands'

export type StepErrorKind =
  | 'validation'
  | 'guard'
  | 'run'
  | 'typed'
  | 'defect'
  | 'timeout'
  | 'compensate'
  | 'interrupted'
  | 'child'
  | 'hook'
  | 'sync-violation'

/** Serializable error. Never carries a stack. */
export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly code?: string
}

/** Standard Schema v1 issue, kept structural so core has zero runtime deps. */
export interface Issue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
}

/** Primary failure retained while a run is halted or compensating. */
export interface RunFailureState {
  readonly step?: string
  readonly error: SerializedError
  readonly kind?: StepErrorKind | 'runtime'
  readonly at?: number
  readonly attempt?: number
  readonly issues?: readonly Issue[]
  readonly data?: unknown
}

export interface CompensationFailureState {
  readonly step: string
  readonly runId: number
  readonly error: SerializedError
}

/** `completed` = every compensation hook succeeded; `partial` = at least one failed (see `failures`). */
export type CompensationOutcome = 'completed' | 'partial'

/** Exact terminal facts retained with a snapshot. */
export interface TerminalState {
  readonly status: 'done' | 'failed' | 'cancelled'
  readonly output?: unknown
  readonly failure?: RunFailureState
  readonly reason?: string
  readonly compensation?: {
    readonly outcome: CompensationOutcome
    readonly failures: readonly CompensationFailureState[]
  }
}

export interface InboxEntry {
  readonly id: string
  readonly event: string
  readonly payload: unknown
  readonly at: number
  readonly expiresAt: number
}

export interface TimerEntry {
  readonly at: number
  readonly fire: Command | TimerFired
  readonly purpose?: 'retry' | 'waitTimeout' | 'sleep' | 'inboxTtl' | 'compensationGrace'
  readonly step?: string
}
