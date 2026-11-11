/**
 * `@openwizard/durable/testing`: the conformance suite for `DurableStore`
 * adapters. Run it from a Vitest test file against a fresh store per test:
 *
 * ```ts
 * import { durableStoreContract } from '@openwizard/durable/testing'
 *
 * durableStoreContract('my store', async (options) => ({
 *   store: createMyStore(await connect(), options),
 *   close: () => disconnect(),
 * }))
 * ```
 *
 * @packageDocumentation
 */

import type { DurableStore, RetentionPolicy } from '@openwizard/durable/store'
import { afterEach, beforeEach, describe } from 'vitest'
import { dedupeCases } from './conformance/dedupe'
import { leaseAndRecordCases } from './conformance/leases'
import type { ConformanceContext } from './conformance/support'
import { timerCases } from './conformance/timers'

/**
 * The configuration a conformance store must be built with. Pass every field
 * to the adapter: the suite drives the clock through `now` and asserts on
 * these exact TTLs.
 *
 * @public
 */
export interface DurableStoreConformanceOptions {
  readonly now: () => number
  readonly leaseTtlMs: number
  readonly timerClaimTtlMs: number
  readonly retention: RetentionPolicy
}

/**
 * A fresh, empty store for one conformance test, plus its teardown.
 *
 * @public
 */
export interface DurableStoreConformanceHarness {
  readonly store: DurableStore
  close?(): void | Promise<void>
}

/**
 * Register the `DurableStore` conformance tests (leases, snapshot CAS, command
 * dedupe ordering, timer claims, retention, linearizability) in a Vitest
 * `describe` block. `createStore` is called once per test with the options the
 * store must use.
 *
 * @public
 */
export function durableStoreContract(
  name: string,
  createStore: (
    options: DurableStoreConformanceOptions,
  ) => DurableStoreConformanceHarness | Promise<DurableStoreConformanceHarness>,
): void {
  describe(name, () => {
    let now = 0
    let harness: DurableStoreConformanceHarness | undefined
    const context: ConformanceContext = {
      store() {
        if (harness === undefined) throw new Error('the conformance store is not open')
        return harness.store
      },
      advance(milliseconds) {
        now += milliseconds
      },
    }

    beforeEach(async () => {
      now = 0
      harness = await createStore({
        now: () => now,
        leaseTtlMs: 10,
        timerClaimTtlMs: 5,
        retention: { completedDedupeMs: 5, timerClaimMs: 0 },
      })
    })

    afterEach(async () => {
      await harness?.close?.()
      harness = undefined
    })

    leaseAndRecordCases(context)
    dedupeCases(context)
    timerCases(context)
  })
}
