import { DurableStore, RetentionPolicy } from "@openwizard/durable/store";
//#region src/testing.d.ts
/**
 * The configuration a conformance store must be built with. Pass every field
 * to the adapter: the suite drives the clock through `now` and asserts on
 * these exact TTLs.
 *
 * @public
 */
interface DurableStoreConformanceOptions {
  readonly now: () => number;
  readonly leaseTtlMs: number;
  readonly timerClaimTtlMs: number;
  readonly retention: RetentionPolicy;
}
/**
 * A fresh, empty store for one conformance test, plus its teardown.
 *
 * @public
 */
interface DurableStoreConformanceHarness {
  readonly store: DurableStore;
  close?(): void | Promise<void>;
}
/**
 * Register the `DurableStore` conformance tests (leases, snapshot CAS, command
 * dedupe ordering, timer claims, retention, linearizability) in a Vitest
 * `describe` block. `createStore` is called once per test with the options the
 * store must use.
 *
 * @public
 */
declare function durableStoreContract(name: string, createStore: (options: DurableStoreConformanceOptions) => DurableStoreConformanceHarness | Promise<DurableStoreConformanceHarness>): void;
//#endregion
export { DurableStoreConformanceHarness, DurableStoreConformanceOptions, durableStoreContract };
//# sourceMappingURL=testing.d.ts.map