/**
 * @openwizard/durable is the storage and coordination contract for a multi-owner
 * host. It supplies leases, fencing, snapshot CAS, idempotency records, timer
 * claims, metadata retention, and an opt-in `FlowRun` host integration.
 *
 * The normal `@openwizard/core` `createRun` and `Store` remain separate and
 * single-owner. Durable task execution is at-least-once; this package makes no
 * exactly-once claim.
 *
 * @packageDocumentation
 */

export {
  type AcquireLeaseResult,
  type CommitInput,
  type CommitResult,
  type DedupeClaimInput,
  type DedupeClaimResult,
  type DedupeCompletion,
  type DedupeKind,
  type DurableRecord,
  type DurableResultCode,
  type DurableStore,
  DurableStoreError,
  type DurableStoreErrorCode,
  type FenceToken,
  type Lease,
  type LeaseOptions,
  type MemoryDurableStore,
  type MemoryDurableStoreOptions,
  type ReleaseLeaseResult,
  type RenewLeaseResult,
  type RetentionPolicy,
  type RetentionSweepOptions,
  type RetentionSweepResult,
  type TimerClaimInput,
  type TimerClaimResult,
  type TimerCompletion,
  type Version,
} from './contracts'
export {
  createDurableRun,
  type DurableCommandOptions,
  type DurableCommandResult,
  type DurableEventOptions,
  type DurableEventResult,
  type DurableResumeOptions,
  type DurableRunFailureCode,
  type DurableRunHost,
  type DurableRunOpenResult,
  type DurableRunOptions,
  resumeDurableRun,
} from './durable-run'
export { createMemoryDurableStore } from './memory-store'
