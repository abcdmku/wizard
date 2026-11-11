import type { DurableStore } from '@openwizard/durable/store'
import type { TablesRelationalConfig } from 'drizzle-orm'
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import {
  type BaseSQLiteDatabase,
  index,
  integer,
  primaryKey,
  sqliteTableCreator,
  text,
} from 'drizzle-orm/sqlite-core'
import {
  createDrizzleDurableStore,
  type DrizzleDurableRepository,
  type DrizzleDurableStoreOptions,
  type LockedRunRepository,
  type RunPatch,
  type RunRow,
} from './store'

/** Controls the table names created by `defineSqliteDurableSchema`. @public */
export interface SqliteDurableSchemaOptions {
  readonly tablePrefix?: string
}

/**
 * Create SQLite Drizzle tables for durable coordination.
 *
 * Call this in the application's schema module and export the returned tables
 * so Drizzle Kit includes them in the application's own migrations.
 *
 * @public
 */
export function defineSqliteDurableSchema(options: SqliteDurableSchemaOptions = {}) {
  const prefix = options.tablePrefix ?? 'openwizard_'
  const table = sqliteTableCreator((name) => `${prefix}${name}`)
  const runs = table('runs', {
    key: text('run_key').primaryKey(),
    fenceCounter: integer('fence_counter').notNull().default(0),
    claimCounter: integer('claim_counter').notNull().default(0),
    ownerId: text('owner_id'),
    fence: text('fence'),
    leaseExpiresAt: integer('lease_expires_at_ms'),
    snapshotEpoch: integer('snapshot_epoch'),
    snapshotSeq: integer('snapshot_seq'),
    snapshot: text('snapshot'),
  })
  const dedupe = table(
    'dedupe',
    {
      runKey: text('run_key')
        .notNull()
        .references(() => runs.key, { onDelete: 'cascade' }),
      dedupeId: text('dedupe_id').notNull(),
      digest: text('digest').notNull(),
      status: text('status').$type<'pending' | 'applied' | 'completed'>().notNull(),
      claimId: text('claim_id').notNull(),
      ownerFence: text('owner_fence').notNull(),
      claimedAt: integer('claimed_at_ms').notNull(),
      request: text('request'),
      result: text('result'),
      completedAt: integer('completed_at_ms'),
    },
    (columns) => [
      primaryKey({ columns: [columns.runKey, columns.dedupeId] }),
      index(`${prefix}dedupe_retention_idx`).on(columns.status, columns.completedAt),
    ],
  )
  const timers = table(
    'timers',
    {
      runKey: text('run_key')
        .notNull()
        .references(() => runs.key, { onDelete: 'cascade' }),
      timerId: text('timer_id').notNull(),
      dueAt: integer('due_at_ms').notNull(),
      expectedEpoch: integer('expected_epoch').notNull(),
      expectedSeq: integer('expected_seq').notNull(),
      claimId: text('claim_id').notNull(),
      ownerFence: text('owner_fence').notNull(),
      claimedUntil: integer('claimed_until_ms').notNull(),
    },
    (columns) => [
      primaryKey({ columns: [columns.runKey, columns.timerId] }),
      index(`${prefix}timer_retention_idx`).on(columns.claimedUntil),
    ],
  )
  return { runs, dedupe, timers }
}

/** SQLite tables returned by `defineSqliteDurableSchema`. @public */
export type SqliteDurableSchema = ReturnType<typeof defineSqliteDurableSchema>

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
export function createSqliteDrizzleDurableStore<
  TRunResult,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: BaseSQLiteDatabase<'async', TRunResult, TFullSchema, TSchema>,
  schema: SqliteDurableSchema,
  options: DrizzleDurableStoreOptions = {},
): DurableStore {
  return createDrizzleDurableStore(createSqliteRepository(db, schema), options)
}

function createSqliteRepository<
  TRunResult,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: BaseSQLiteDatabase<'async', TRunResult, TFullSchema, TSchema>,
  schema: SqliteDurableSchema,
): DrizzleDurableRepository {
  const { runs, dedupe, timers } = schema
  const writes = createWriteQueue()

  return {
    async readRun(key) {
      const rows = await db.select().from(runs).where(eq(runs.key, key)).limit(1)
      return rows[0] ?? null
    },

    async withLockedRun(key, create, operation) {
      return writes.run(() =>
        db.transaction(
          async (tx) => {
            if (create) {
              await tx.insert(runs).values({ key }).onConflictDoNothing({ target: runs.key })
            }
            const rows = await tx.select().from(runs).where(eq(runs.key, key)).limit(1)
            const row = rows[0]
            if (row === undefined) return { found: false as const }

            const locked: LockedRunRepository = {
              row,
              async updateRun(patch) {
                await tx.update(runs).set(patch).where(eq(runs.key, key))
                applyRunPatch(row, patch)
              },
              async readDedupe(id) {
                const rows = await tx
                  .select()
                  .from(dedupe)
                  .where(and(eq(dedupe.runKey, key), eq(dedupe.dedupeId, id)))
                  .limit(1)
                return rows[0] ?? null
              },
              async insertDedupe(value) {
                await tx.insert(dedupe).values(value)
              },
              async updateDedupe(id, value) {
                await tx
                  .update(dedupe)
                  .set(value)
                  .where(and(eq(dedupe.runKey, key), eq(dedupe.dedupeId, id)))
              },
              async readTimer(timerId) {
                const rows = await tx
                  .select()
                  .from(timers)
                  .where(and(eq(timers.runKey, key), eq(timers.timerId, timerId)))
                  .limit(1)
                return rows[0] ?? null
              },
              async putTimer(value) {
                await tx
                  .insert(timers)
                  .values(value)
                  .onConflictDoUpdate({
                    target: [timers.runKey, timers.timerId],
                    set: {
                      dueAt: value.dueAt,
                      expectedEpoch: value.expectedEpoch,
                      expectedSeq: value.expectedSeq,
                      claimId: value.claimId,
                      ownerFence: value.ownerFence,
                      claimedUntil: value.claimedUntil,
                    },
                  })
              },
              async deleteTimer(timerId) {
                await tx
                  .delete(timers)
                  .where(and(eq(timers.runKey, key), eq(timers.timerId, timerId)))
              },
            }
            return { found: true as const, value: await operation(locked) }
          },
          { behavior: 'immediate' },
        ),
      )
    },

    async sweep(input) {
      if (input.limit === 0) return { dedupeRemoved: 0, timerClaimsRemoved: 0 }
      return writes.run(() =>
        db.transaction(
          async (tx) => {
            const dedupeRows = await tx
              .select({ runKey: dedupe.runKey, dedupeId: dedupe.dedupeId })
              .from(dedupe)
              .where(
                and(
                  eq(dedupe.status, 'completed'),
                  isNotNull(dedupe.completedAt),
                  lte(dedupe.completedAt, input.dedupeCompletedBefore),
                ),
              )
              .limit(input.limit)
            for (const row of dedupeRows) {
              await tx
                .delete(dedupe)
                .where(and(eq(dedupe.runKey, row.runKey), eq(dedupe.dedupeId, row.dedupeId)))
            }

            const remaining = input.limit - dedupeRows.length
            const timerRows =
              remaining === 0
                ? []
                : await tx
                    .select({ runKey: timers.runKey, timerId: timers.timerId })
                    .from(timers)
                    .where(lte(timers.claimedUntil, input.timerClaimedBefore))
                    .limit(remaining)
            for (const row of timerRows) {
              await tx
                .delete(timers)
                .where(and(eq(timers.runKey, row.runKey), eq(timers.timerId, row.timerId)))
            }
            return { dedupeRemoved: dedupeRows.length, timerClaimsRemoved: timerRows.length }
          },
          { behavior: 'immediate' },
        ),
      )
    },
  }
}

function createWriteQueue(): { run<Result>(operation: () => Promise<Result>): Promise<Result> } {
  let tail: Promise<void> = Promise.resolve()
  return {
    async run<Result>(operation: () => Promise<Result>): Promise<Result> {
      const previous = tail
      let release = () => {}
      tail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        return await operation()
      } finally {
        release()
      }
    },
  }
}

function applyRunPatch(row: RunRow, patch: RunPatch): void {
  Object.assign(row, patch)
}
