/**
 * @openwizard/durable is the storage and coordination contract for a multi-owner
 * host. It supplies leases, fencing, snapshot CAS, idempotency records, timer
 * claims, metadata retention, and an opt-in `Run` host integration.
 *
 * Core wizard creators and `Store` remain single-owner. Durable task execution is at-least-once; this package makes no
 * exactly-once claim.
 *
 * @packageDocumentation
 */

// Durable runs of one wizard, addressed by key.
export {
  createDurableHost,
  type DurableCreateOptions,
  type DurableHost,
  type DurableHostOpenFailure,
  type DurableHostOpenResult,
  type DurableHostOptions,
} from './durable-host'
// The run host.
export {
  createDurableRun,
  type DurableCommandOptions,
  type DurableCommandResult,
  type DurableEventOptions,
  type DurableEventResult,
  type DurableHostFailure,
  type DurableResumeOptions,
  type DurableRunFailureCode,
  type DurableRunHost,
  type DurableRunOpenFailure,
  type DurableRunOpenResult,
  type DurableRunOptions,
  resumeDurableRun,
} from './durable-run'
export type { DurableLeaseLossCode } from './durable-run-state'
export {
  createHostRegistry,
  type HostOpenContext,
  type HostOpenResult,
  type HostRegistryDisposed,
  type HostRegistryOpenResult,
} from './host-registry'
export {
  createMemoryDurableStore,
  type MemoryDurableStore,
  type MemoryDurableStoreOptions,
} from './memory-store'
