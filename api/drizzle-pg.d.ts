import { TablesRelationalConfig } from "drizzle-orm";
import { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { DurableStore, RetentionPolicy } from "@openwizard/durable/store";
//#region src/store-types.d.ts
/** Options shared by the Drizzle durable-store adapters. @public */
interface DrizzleDurableStoreOptions {
  readonly now?: () => number;
  readonly leaseTtlMs?: number;
  readonly timerClaimTtlMs?: number;
  readonly retention?: RetentionPolicy;
}
//#endregion
//#region src/pg.d.ts
/** Controls the table names created by `definePgDurableSchema`. @public */
interface PgDurableSchemaOptions {
  readonly tablePrefix?: string;
}
/**
 * Create PostgreSQL Drizzle tables for durable coordination.
 *
 * Call this in the application's schema module and export the returned tables
 * so Drizzle Kit includes them in the application's own migrations.
 *
 * @public
 */
declare function definePgDurableSchema(options?: PgDurableSchemaOptions): {
  runs: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "runs";
    schema: undefined;
    columns: {
      key: import("drizzle-orm/pg-core").PgColumn<{
        name: "run_key";
        tableName: "runs";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      fenceCounter: import("drizzle-orm/pg-core").PgColumn<{
        name: "fence_counter";
        tableName: "runs";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      claimCounter: import("drizzle-orm/pg-core").PgColumn<{
        name: "claim_counter";
        tableName: "runs";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      ownerId: import("drizzle-orm/pg-core").PgColumn<{
        name: "owner_id";
        tableName: "runs";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      fence: import("drizzle-orm/pg-core").PgColumn<{
        name: "fence";
        tableName: "runs";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      leaseExpiresAt: import("drizzle-orm/pg-core").PgColumn<{
        name: "lease_expires_at_ms";
        tableName: "runs";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      snapshotEpoch: import("drizzle-orm/pg-core").PgColumn<{
        name: "snapshot_epoch";
        tableName: "runs";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      snapshotSeq: import("drizzle-orm/pg-core").PgColumn<{
        name: "snapshot_seq";
        tableName: "runs";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      snapshot: import("drizzle-orm/pg-core").PgColumn<{
        name: "snapshot";
        tableName: "runs";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
    };
    dialect: "pg";
  }>;
  dedupe: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "dedupe";
    schema: undefined;
    columns: {
      runKey: import("drizzle-orm/pg-core").PgColumn<{
        name: "run_key";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      dedupeId: import("drizzle-orm/pg-core").PgColumn<{
        name: "dedupe_id";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      digest: import("drizzle-orm/pg-core").PgColumn<{
        name: "digest";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      status: import("drizzle-orm/pg-core").PgColumn<{
        name: "status";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: "pending" | "applied" | "completed";
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {
        $type: "pending" | "applied" | "completed";
      }>;
      claimId: import("drizzle-orm/pg-core").PgColumn<{
        name: "claim_id";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      ownerFence: import("drizzle-orm/pg-core").PgColumn<{
        name: "owner_fence";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      claimedAt: import("drizzle-orm/pg-core").PgColumn<{
        name: "claimed_at_ms";
        tableName: "dedupe";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      request: import("drizzle-orm/pg-core").PgColumn<{
        name: "request";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      result: import("drizzle-orm/pg-core").PgColumn<{
        name: "result";
        tableName: "dedupe";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      completedAt: import("drizzle-orm/pg-core").PgColumn<{
        name: "completed_at_ms";
        tableName: "dedupe";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
    };
    dialect: "pg";
  }>;
  timers: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "timers";
    schema: undefined;
    columns: {
      runKey: import("drizzle-orm/pg-core").PgColumn<{
        name: "run_key";
        tableName: "timers";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      timerId: import("drizzle-orm/pg-core").PgColumn<{
        name: "timer_id";
        tableName: "timers";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      dueAt: import("drizzle-orm/pg-core").PgColumn<{
        name: "due_at_ms";
        tableName: "timers";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      expectedEpoch: import("drizzle-orm/pg-core").PgColumn<{
        name: "expected_epoch";
        tableName: "timers";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      expectedSeq: import("drizzle-orm/pg-core").PgColumn<{
        name: "expected_seq";
        tableName: "timers";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      claimId: import("drizzle-orm/pg-core").PgColumn<{
        name: "claim_id";
        tableName: "timers";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      ownerFence: import("drizzle-orm/pg-core").PgColumn<{
        name: "owner_fence";
        tableName: "timers";
        dataType: "string";
        columnType: "PgText";
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
      claimedUntil: import("drizzle-orm/pg-core").PgColumn<{
        name: "claimed_until_ms";
        tableName: "timers";
        dataType: "number";
        columnType: "PgBigInt53";
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      }, {}, {}>;
    };
    dialect: "pg";
  }>;
};
/** PostgreSQL tables returned by `definePgDurableSchema`. @public */
type PgDurableSchema = ReturnType<typeof definePgDurableSchema>;
/**
 * Adapt a PostgreSQL Drizzle database to the OpenWizard `DurableStore` port.
 *
 * The caller owns the connection, schema, migrations, and infrastructure.
 *
 * @public
 */
declare function createPgDrizzleDurableStore<TQueryResult extends PgQueryResultHKT, TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>(db: PgDatabase<TQueryResult, TFullSchema, TSchema>, schema: PgDurableSchema, options?: DrizzleDurableStoreOptions): DurableStore;
//#endregion
export { PgDurableSchema, PgDurableSchemaOptions, createPgDrizzleDurableStore, definePgDurableSchema };
//# sourceMappingURL=pg.d.ts.map