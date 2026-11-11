import { TablesRelationalConfig } from "drizzle-orm";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
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
//#region src/sqlite.d.ts
/** Controls the table names created by `defineSqliteDurableSchema`. @public */
interface SqliteDurableSchemaOptions {
  readonly tablePrefix?: string;
}
/**
 * Create SQLite Drizzle tables for durable coordination.
 *
 * Call this in the application's schema module and export the returned tables
 * so Drizzle Kit includes them in the application's own migrations.
 *
 * @public
 */
declare function defineSqliteDurableSchema(options?: SqliteDurableSchemaOptions): {
  runs: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "runs";
    schema: undefined;
    columns: {
      key: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "run_key";
        tableName: "runs";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      fenceCounter: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "fence_counter";
        tableName: "runs";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      claimCounter: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "claim_counter";
        tableName: "runs";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "owner_id";
        tableName: "runs";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      fence: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "fence";
        tableName: "runs";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      leaseExpiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "lease_expires_at_ms";
        tableName: "runs";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      snapshotEpoch: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "snapshot_epoch";
        tableName: "runs";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      snapshotSeq: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "snapshot_seq";
        tableName: "runs";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      snapshot: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "snapshot";
        tableName: "runs";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
    };
    dialect: "sqlite";
  }>;
  dedupe: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "dedupe";
    schema: undefined;
    columns: {
      runKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "run_key";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      dedupeId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "dedupe_id";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      digest: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "digest";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      status: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "status";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
        length: number | undefined;
        $type: "pending" | "applied" | "completed";
      }>;
      claimId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "claim_id";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      ownerFence: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "owner_fence";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      claimedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "claimed_at_ms";
        tableName: "dedupe";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      request: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "request";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      result: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "result";
        tableName: "dedupe";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      completedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "completed_at_ms";
        tableName: "dedupe";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
    dialect: "sqlite";
  }>;
  timers: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "timers";
    schema: undefined;
    columns: {
      runKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "run_key";
        tableName: "timers";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      timerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "timer_id";
        tableName: "timers";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      dueAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "due_at_ms";
        tableName: "timers";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      expectedEpoch: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "expected_epoch";
        tableName: "timers";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      expectedSeq: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "expected_seq";
        tableName: "timers";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
      claimId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "claim_id";
        tableName: "timers";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      ownerFence: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "owner_fence";
        tableName: "timers";
        dataType: "string";
        columnType: "SQLiteText";
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
      }, {}, {
        length: number | undefined;
      }>;
      claimedUntil: import("drizzle-orm/sqlite-core").SQLiteColumn<{
        name: "claimed_until_ms";
        tableName: "timers";
        dataType: "number";
        columnType: "SQLiteInteger";
        data: number;
        driverParam: number;
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
    dialect: "sqlite";
  }>;
};
/** SQLite tables returned by `defineSqliteDurableSchema`. @public */
type SqliteDurableSchema = ReturnType<typeof defineSqliteDurableSchema>;
/**
 * Adapt an asynchronous SQLite Drizzle database to the OpenWizard
 * `DurableStore` port.
 *
 * The caller owns the connection, schema, migrations, and infrastructure.
 * Synchronous SQLite drivers are intentionally excluded because their
 * transaction callbacks cannot await the durable operation.
 *
 * @public
 */
declare function createSqliteDrizzleDurableStore<TRunResult, TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>(db: BaseSQLiteDatabase<'async', TRunResult, TFullSchema, TSchema>, schema: SqliteDurableSchema, options?: DrizzleDurableStoreOptions): DurableStore;
//#endregion
export { SqliteDurableSchema, SqliteDurableSchemaOptions, createSqliteDrizzleDurableStore, defineSqliteDurableSchema };
//# sourceMappingURL=sqlite.d.ts.map