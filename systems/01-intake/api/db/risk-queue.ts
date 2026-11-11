import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import {
  claimRiskJob,
  findRiskJobByFingerprint,
  queueOwnedRiskJob,
  readQueueDuration,
  readQueueLimit,
} from './risk-queue-operations'
import {
  type NewRiskJobRecord,
  type RiskJobRecord,
  type RiskReviewOutcome,
  riskJobs,
} from './schema'
import type { IntakeDrizzleDatabase } from './types'

export type EnqueueRiskJobInput = Pick<
  NewRiskJobRecord,
  'applicationId' | 'tenantId' | 'fingerprint' | 'input'
> & {
  readonly id?: string
}

export interface ClaimRiskJobInput {
  readonly workerId: string
  readonly leaseMs?: number
}

export interface CompleteRiskJobInput {
  readonly jobId: string
  readonly workerId: string
  readonly score: number
  readonly outcome: RiskReviewOutcome
  readonly reasons: readonly string[]
}

export interface FailRiskJobInput {
  readonly jobId: string
  readonly workerId: string
  readonly error: string
  readonly retryAfterMs?: number
}

export interface RequeueRiskJobInput {
  readonly jobId: string
  readonly workerId: string
  readonly availableAt?: Date
}

export interface ListRiskCompletionsInput {
  readonly tenantId?: string
  readonly limit?: number
}

export interface RiskJobQueue {
  enqueue(input: EnqueueRiskJobInput): Promise<RiskJobRecord>
  get(tenantId: string, jobId: string): Promise<RiskJobRecord | null>
  getByFingerprint(
    tenantId: string,
    applicationId: string,
    fingerprint: string,
  ): Promise<RiskJobRecord | null>
  claim(input: ClaimRiskJobInput): Promise<RiskJobRecord | null>
  complete(input: CompleteRiskJobInput): Promise<RiskJobRecord | null>
  fail(input: FailRiskJobInput): Promise<RiskJobRecord | null>
  requeue(input: RequeueRiskJobInput): Promise<RiskJobRecord | null>
  undelivered(input?: ListRiskCompletionsInput): Promise<readonly RiskJobRecord[]>
  markDelivered(tenantId: string, jobId: string): Promise<RiskJobRecord | null>
}

export interface RiskJobQueueOptions {
  readonly now?: () => Date
  readonly defaultLeaseMs?: number
}

export function createRiskJobQueue(
  db: IntakeDrizzleDatabase,
  options: RiskJobQueueOptions = {},
): RiskJobQueue {
  const now = options.now ?? (() => new Date())
  const defaultLeaseMs = readQueueDuration(options.defaultLeaseMs, 30_000, 'defaultLeaseMs')

  return {
    async enqueue(input) {
      const values = input.id === undefined ? input : { ...input, id: input.id }
      const inserted = await db
        .insert(riskJobs)
        .values(values)
        .onConflictDoNothing({
          target: [riskJobs.tenantId, riskJobs.applicationId, riskJobs.fingerprint],
        })
        .returning()
      if (inserted[0] !== undefined) return inserted[0]

      const existing = await findRiskJobByFingerprint(
        db,
        input.tenantId,
        input.applicationId,
        input.fingerprint,
      )
      if (existing === null) throw new Error('risk job conflict did not resolve to an existing row')
      return existing
    },

    async get(tenantId, jobId) {
      const rows = await db
        .select()
        .from(riskJobs)
        .where(and(eq(riskJobs.tenantId, tenantId), eq(riskJobs.id, jobId)))
        .limit(1)
      return rows[0] ?? null
    },

    getByFingerprint(tenantId, applicationId, fingerprint) {
      return findRiskJobByFingerprint(db, tenantId, applicationId, fingerprint)
    },

    async claim(input) {
      const claimedAt = now()
      const leaseMs = readQueueDuration(input.leaseMs, defaultLeaseMs, 'leaseMs')
      return claimRiskJob(db, { workerId: input.workerId, leaseMs }, claimedAt)
    },

    async complete(input) {
      const completedAt = now()
      const rows = await db
        .update(riskJobs)
        .set({
          status: 'completed',
          score: input.score,
          outcome: input.outcome,
          reasons: input.reasons,
          completedAt,
          updatedAt: completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
        })
        .where(
          and(
            eq(riskJobs.id, input.jobId),
            eq(riskJobs.status, 'processing'),
            eq(riskJobs.leaseOwner, input.workerId),
            gt(riskJobs.leaseExpiresAt, completedAt),
          ),
        )
        .returning()
      return rows[0] ?? null
    },

    async fail(input) {
      const failedAt = now()
      const retryAfterMs = readQueueDuration(input.retryAfterMs, 1_000, 'retryAfterMs')
      return queueOwnedRiskJob(db, input.jobId, input.workerId, {
        availableAt: new Date(failedAt.getTime() + retryAfterMs),
        lastError: input.error,
        updatedAt: failedAt,
      })
    },

    async requeue(input) {
      const requeuedAt = now()
      return queueOwnedRiskJob(db, input.jobId, input.workerId, {
        availableAt: input.availableAt ?? requeuedAt,
        lastError: null,
        updatedAt: requeuedAt,
      })
    },

    async undelivered(input = {}) {
      const base = and(eq(riskJobs.status, 'completed'), isNull(riskJobs.deliveredAt))
      const condition =
        input.tenantId === undefined ? base : and(base, eq(riskJobs.tenantId, input.tenantId))
      return db
        .select()
        .from(riskJobs)
        .where(condition)
        .orderBy(asc(riskJobs.completedAt), asc(riskJobs.id))
        .limit(readQueueLimit(input.limit))
    },

    async markDelivered(tenantId, jobId) {
      const deliveredAt = now()
      const rows = await db
        .update(riskJobs)
        .set({ deliveredAt, updatedAt: deliveredAt })
        .where(
          and(
            eq(riskJobs.tenantId, tenantId),
            eq(riskJobs.id, jobId),
            eq(riskJobs.status, 'completed'),
            isNull(riskJobs.deliveredAt),
          ),
        )
        .returning()
      return rows[0] ?? null
    },
  }
}
