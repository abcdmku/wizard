import type { AnyWizard, Command, CommandResult, Run, RunEvent, Snapshot } from '@openwizard/core'
import type {
  DedupeApplication,
  DurableStore,
  Lease,
  LeaseOptions,
  RenewLeaseResult,
  Version,
} from '@openwizard/durable/store'
import type { DurableHostFailure } from './durable-run'

/** Why a durable host stopped on its own: its lease, snapshot CAS, or a timer claim was lost. @public */
export type DurableLeaseLossCode = 'LEASE_LOST' | 'CAS_CONFLICT' | 'TIMER_CLAIM_LOST'

export type CommitFailureCode =
  | 'LEASE_LOST'
  | 'CAS_CONFLICT'
  | 'INVALID_VERSION'
  | 'DEDUPLICATE_CONFLICT'
  | 'TIMER_CLAIM_LOST'

export interface BarrierInput<F extends AnyWizard> {
  readonly snapshot: Snapshot<F>
  readonly events: readonly RunEvent<F>[]
  readonly commands?: readonly {
    /** The exact source object passed to `run.dispatch`, including later navigation batches. */
    readonly command: Command<F>
    readonly result?: CommandResult
  }[]
}

export interface PendingCommand<F extends AnyWizard> extends DedupeApplication {
  readonly command: Command<F>
  readonly digest: string
  /** Written only after the result and its snapshot have committed together. */
  completedVersion?: Version
  failure?: DurableHostFailure
}

export interface HostState<F extends AnyWizard> {
  readonly run: Run<F>
  readonly getLease: () => Lease
  readonly getVersion: () => Version
  readonly getPersistedVersion: () => Version | null
  readonly awaitBarriers: () => Promise<void>
  readonly enqueueBarrier: <Result>(work: () => Promise<Result>) => Promise<Result>
  /** Match barrier associations by source object, never by the next batch or command value. */
  readonly trackCommand: (command: PendingCommand<F> | undefined) => void
  readonly store: DurableStore
  readonly renewLease: (options?: LeaseOptions) => Promise<RenewLeaseResult>
  readonly markLost: (code: DurableLeaseLossCode) => void
  readonly stop: () => void
  readonly isStopped: () => boolean
}
