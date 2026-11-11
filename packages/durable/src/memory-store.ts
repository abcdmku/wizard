import type { DurableStore, RetentionPolicy } from '@openwizard/durable/store'
import { createMemoryClaimOperations } from './memory-store-claims'
import { createMemoryStoreState } from './memory-store-internals'
import { createMemoryRecordOperations } from './memory-store-records'

/**
 * Options for the in-memory store. Its clock is read inside each operation, so
 * a mutable clock can exercise expiry and retention without sleeping.
 *
 * @public
 */
export interface MemoryDurableStoreOptions {
  readonly now?: () => number
  /** Lease TTL when a caller omits `ttlMs`. Default 30 000 ms. */
  readonly leaseTtlMs?: number
  /** How long a timer claim blocks other claims. Default 30 000 ms. */
  readonly timerClaimTtlMs?: number
  /** Default: completed command claims 7 days, timer claims 5 minutes. */
  readonly retention?: RetentionPolicy
}

/**
 * The in-memory store: the exact `DurableStore` contract plus inspection
 * helpers for tests.
 *
 * @public
 */
export interface MemoryDurableStore extends DurableStore {
  /** Return the keys that have acquired a lease or stored metadata. */
  keys(): readonly string[]
  /** Remove all rows and coordination metadata. */
  clear(): void
}

/**
 * In-memory `DurableStore` with synchronous linearization points and JSON
 * round trips at every persistence boundary. For tests and single-process
 * development.
 *
 * @public
 */
export function createMemoryDurableStore(
  options: MemoryDurableStoreOptions = {},
): MemoryDurableStore {
  const state = createMemoryStoreState(options)
  return {
    leaseTtlMs: state.configuration.leaseTtlMs,
    ...createMemoryRecordOperations(state),
    ...createMemoryClaimOperations(state),
    keys() {
      return Object.freeze(Array.from(state.rows.keys()).sort())
    },
    clear() {
      state.rows.clear()
    },
  }
}
