import type { TablesRelationalConfig } from 'drizzle-orm'
import { and, eq, gt, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { PgDurableSchema } from './pg'
import type { DrizzleDurableRepository } from './store-types'

type MetadataFastPaths = Pick<
  DrizzleDurableRepository,
  'claimFreshDedupe' | 'commitDedupeCompletion'
>

export function createPgMetadataFastPaths<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(db: PgDatabase<TQueryResult, TFullSchema, TSchema>, schema: PgDurableSchema): MetadataFastPaths {
  const { runs, dedupe } = schema

  return {
    async claimFreshDedupe(input) {
      const expected =
        input.expectedVersion === undefined
          ? undefined
          : and(
              eq(runs.snapshotEpoch, input.expectedVersion.epoch),
              eq(runs.snapshotSeq, input.expectedVersion.seq),
              isNotNull(runs.snapshot),
            )
      const lockedRun = db.$with('locked_dedupe_claim_run').as(
        db
          .select({ key: runs.key, claimCounter: runs.claimCounter })
          .from(runs)
          .where(
            and(
              eq(runs.key, input.lease.key),
              eq(runs.ownerId, input.lease.ownerId),
              eq(runs.fence, input.lease.fence),
              gt(runs.leaseExpiresAt, input.now),
              gte(runs.claimCounter, 0),
              sql`${runs.claimCounter} < ${Number.MAX_SAFE_INTEGER}`,
              expected,
            ),
          )
          .limit(1)
          .for('update'),
      )
      const inserted = db.$with('inserted_dedupe_claim').as(
        db
          .insert(dedupe)
          .select(
            db
              .select({
                runKey: lockedRun.key,
                dedupeId: sql<string>`${input.id}`.as('dedupe_id'),
                digest: sql<string>`${input.digest}`.as('digest'),
                status: sql<'pending'>`'pending'`.as('status'),
                claimId: sql<string>`'dedupe:' || (${lockedRun.claimCounter} + 1)::text`.as(
                  'claim_id',
                ),
                ownerFence: sql<string>`${input.lease.fence}`.as('owner_fence'),
                claimedAt: sql<number>`${input.now}`.as('claimed_at_ms'),
                request: sql<string | null>`${input.request}`.as('request'),
                result: sql<string | null>`null`.as('result'),
                completedAt: sql<number | null>`null`.as('completed_at_ms'),
              })
              .from(lockedRun),
          )
          .onConflictDoNothing({ target: [dedupe.runKey, dedupe.dedupeId] })
          .returning({ runKey: dedupe.runKey, claimId: dedupe.claimId }),
      )
      const rows = await db
        .with(lockedRun, inserted)
        .update(runs)
        .set({ claimCounter: sql`${runs.claimCounter} + 1` })
        .from(inserted)
        .where(and(eq(runs.key, input.lease.key), eq(runs.key, inserted.runKey)))
        .returning({ claimId: inserted.claimId })
      const row = rows[0]
      return row === undefined ? null : { claimId: row.claimId }
    },

    async commitDedupeCompletion(input) {
      const expected =
        input.expected === null
          ? or(isNull(runs.snapshotEpoch), isNull(runs.snapshotSeq), isNull(runs.snapshot))
          : and(
              eq(runs.snapshotEpoch, input.expected.epoch),
              eq(runs.snapshotSeq, input.expected.seq),
              isNotNull(runs.snapshot),
            )
      const lockedRun = db.$with('locked_dedupe_completion_run').as(
        db
          .select({ key: runs.key })
          .from(runs)
          .where(
            and(
              eq(runs.key, input.lease.key),
              eq(runs.ownerId, input.lease.ownerId),
              eq(runs.fence, input.lease.fence),
              gt(runs.leaseExpiresAt, input.now),
              expected,
            ),
          )
          .limit(1)
          .for('update'),
      )
      const rows = await db
        .with(lockedRun)
        .update(dedupe)
        .set({ status: 'completed', result: input.result, completedAt: input.now })
        .from(lockedRun)
        .where(
          and(
            eq(dedupe.runKey, lockedRun.key),
            eq(dedupe.dedupeId, input.id),
            inArray(dedupe.status, ['pending', 'applied']),
            eq(dedupe.digest, input.digest),
            eq(dedupe.claimId, input.claimId),
            eq(dedupe.ownerFence, input.lease.fence),
          ),
        )
        .returning({ key: dedupe.runKey })
      return rows.length === 0 ? null : { version: input.expected }
    },
  }
}
