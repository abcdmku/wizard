import type { DurableStore } from '@openwizard/durable'
import type { TablesRelationalConfig } from 'drizzle-orm'
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import {
  bigint,
  index,
  type PgDatabase,
  type PgQueryResultHKT,
  pgTableCreator,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core'
import {
  createDrizzleDurableStore,
  type DrizzleDurableRepository,
  type DrizzleDurableStoreOptions,
  type LockedRunRepository,
  type RunPatch,
  type RunRow,
} from './store'

/** Controls the table names created by `definePgDurableSchema`. @public */
export interface PgDurableSchemaOptions {
  readonly tablePrefix?: string
}

/**
 * Create PostgreSQL Drizzle tables for durable coordination.
 *
 * Call this in the application's schema module and export the returned tables
 * so Drizzle Kit includes them in the application's own migrations.
 *
 * @public
 */
export function definePgDurableSchema(options: PgDurableSchemaOptions = {}) {
  const prefix = options.tablePrefix ?? 'openwizard_'
  const table = pgTableCreator((name) => `${prefix}${name}`)
  const runs = table('runs', {
    key: text('run_key').primaryKey(),
    fenceCounter: bigint('fence_counter', { mode: 'number' }).notNull().default(0),
    claimCounter: bigint('claim_counter', { mode: 'number' }).notNull().default(0),
    ownerId: text('owner_id'),
    fence: text('fence'),
    leaseExpiresAt: bigint('lease_expires_at_ms', { mode: 'number' }),
    snapshotEpoch: bigint('snapshot_epoch', { mode: 'number' }),
    snapshotSeq: bigint('snapshot_seq', { mode: 'number' }),
    snapshot: text('snapshot'),
  })
  const dedupe = table(
    'dedupe',
    {
      runKey: text('run_key')
        .notNull()
        .references(() => runs.key, { onDelete: 'cascade' }),
      kind: text('kind').$type<'command' | 'event'>().notNull(),
      dedupeId: text('dedupe_id').notNull(),
      digest: text('digest').notNull(),
      status: text('status').$type<'pending' | 'completed'>().notNull(),
      claimId: text('claim_id').notNull(),
      ownerFence: text('owner_fence').notNull(),
      claimedAt: bigint('claimed_at_ms', { mode: 'number' }).notNull(),
      request: text('request'),
      result: text('result'),
      completedAt: bigint('completed_at_ms', { mode: 'number' }),
    },
    (columns) => [
      primaryKey({ columns: [columns.runKey, columns.kind, columns.dedupeId] }),
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
      dueAt: bigint('due_at_ms', { mode: 'number' }).notNull(),
      expectedEpoch: bigint('expected_epoch', { mode: 'number' }).notNull(),
      expectedSeq: bigint('expected_seq', { mode: 'number' }).notNull(),
      claimId: text('claim_id').notNull(),
      ownerFence: text('owner_fence').notNull(),
      claimedUntil: bigint('claimed_until_ms', { mode: 'number' }).notNull(),
    },
    (columns) => [
      primaryKey({ columns: [columns.runKey, columns.timerId] }),
      index(`${prefix}timer_retention_idx`).on(columns.claimedUntil),
    ],
  )
  return { runs, dedupe, timers }
}

/** PostgreSQL tables returned by `definePgDurableSchema`. @public */
export type PgDurableSchema = ReturnType<typeof definePgDurableSchema>

/**
 * Adapt a PostgreSQL Drizzle database to the OpenWizard `DurableStore` port.
 *
 * The caller owns the connection, schema, migrations, and infrastructure.
 *
 * @public
 */
export function createPgDrizzleDurableStore<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  schema: PgDurableSchema,
  options: DrizzleDurableStoreOptions = {},
): DurableStore {
  return createDrizzleDurableStore(createPgRepository(db, schema), options)
}

function createPgRepository<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  schema: PgDurableSchema,
): DrizzleDurableRepository {
  const { runs, dedupe, timers } = schema

  return {
    async readRun(key) {
      const rows = await db.select().from(runs).where(eq(runs.key, key)).limit(1)
      return rows[0] ?? null
    },

    async withLockedRun(key, create, operation) {
      return db.transaction(async (tx) => {
        if (create) {
          await tx.insert(runs).values({ key }).onConflictDoNothing({ target: runs.key })
        }
        const rows = await tx.select().from(runs).where(eq(runs.key, key)).limit(1).for('update')
        const row = rows[0]
        if (row === undefined) return { found: false as const }

        const locked: LockedRunRepository = {
          row,
          async updateRun(patch) {
            await tx.update(runs).set(patch).where(eq(runs.key, key))
            applyRunPatch(row, patch)
          },
          async readDedupe(kind, id) {
            const rows = await tx
              .select()
              .from(dedupe)
              .where(and(eq(dedupe.runKey, key), eq(dedupe.kind, kind), eq(dedupe.dedupeId, id)))
              .limit(1)
            return rows[0] ?? null
          },
          async insertDedupe(value) {
            await tx.insert(dedupe).values(value)
          },
          async updateDedupe(kind, id, value) {
            await tx
              .update(dedupe)
              .set(value)
              .where(and(eq(dedupe.runKey, key), eq(dedupe.kind, kind), eq(dedupe.dedupeId, id)))
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
            await tx.delete(timers).where(and(eq(timers.runKey, key), eq(timers.timerId, timerId)))
          },
        }
        return { found: true as const, value: await operation(locked) }
      })
    },

    async sweep(input) {
      if (input.limit === 0) return { dedupeRemoved: 0, timerClaimsRemoved: 0 }
      return db.transaction(async (tx) => {
        const dedupeRows = await tx
          .select({ runKey: dedupe.runKey, kind: dedupe.kind, dedupeId: dedupe.dedupeId })
          .from(dedupe)
          .where(
            and(
              eq(dedupe.status, 'completed'),
              isNotNull(dedupe.completedAt),
              lte(dedupe.completedAt, input.dedupeCompletedBefore),
            ),
          )
          .limit(input.limit)
          .for('update', { skipLocked: true })
        for (const row of dedupeRows) {
          await tx
            .delete(dedupe)
            .where(
              and(
                eq(dedupe.runKey, row.runKey),
                eq(dedupe.kind, row.kind),
                eq(dedupe.dedupeId, row.dedupeId),
              ),
            )
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
                .for('update', { skipLocked: true })
        for (const row of timerRows) {
          await tx
            .delete(timers)
            .where(and(eq(timers.runKey, row.runKey), eq(timers.timerId, row.timerId)))
        }
        return { dedupeRemoved: dedupeRows.length, timerClaimsRemoved: timerRows.length }
      })
    },
  }
}

function applyRunPatch(row: RunRow, patch: RunPatch): void {
  Object.assign(row, patch)
}
