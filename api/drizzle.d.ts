import { RetentionPolicy } from "@openwizard/durable/store";
//#region src/store-types.d.ts
/** Options shared by the Drizzle durable-store adapters. @public */
interface DrizzleDurableStoreOptions {
  readonly now?: () => number;
  readonly leaseTtlMs?: number;
  readonly timerClaimTtlMs?: number;
  readonly retention?: RetentionPolicy;
}
//#endregion
export type { DrizzleDurableStoreOptions };
//# sourceMappingURL=index.d.ts.map