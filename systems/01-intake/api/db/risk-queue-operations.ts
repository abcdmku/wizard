import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm'
import { type RiskJobRecord, riskJobs } from './schema'
import type { IntakeDrizzleDatabase } from './types'

export async function findRiskJobByFingerprint(
  db: IntakeDrizzleDatabase,
  tenantId: string,
  applicationId: string,
  fingerprint: string,
): Promise<RiskJobRecord | null> {
  const rows = await db
    .select()
    .from(riskJobs)
    .where(
      and(
        eq(riskJobs.tenantId, tenantId),
        eq(riskJobs.applicationId, applicationId),
        eq(riskJobs.fingerprint, fingerprint),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function claimRiskJob(
  db: IntakeDrizzleDatabase,
  input: { readonly workerId: string; readonly leaseMs: number },
  claimedAt: Date,
): Promise<RiskJobRecord | null> {
  const leaseExpiresAt = new Date(claimedAt.getTime() + input.leaseMs)
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(riskJobs)
      .where(
        or(
          and(eq(riskJobs.status, 'queued'), lte(riskJobs.availableAt, claimedAt)),
          and(eq(riskJobs.status, 'processing'), lte(riskJobs.leaseExpiresAt, claimedAt)),
        ),
      )
      .orderBy(asc(riskJobs.availableAt), asc(riskJobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })
    const candidate = candidates[0]
    if (candidate === undefined) return null

    const rows = await tx
      .update(riskJobs)
      .set({
        status: 'processing',
        leaseOwner: input.workerId,
        leaseExpiresAt,
        startedAt: claimedAt,
        updatedAt: claimedAt,
        attemptCount: sql`${riskJobs.attemptCount} + 1`,
      })
      .where(eq(riskJobs.id, candidate.id))
      .returning()
    return rows[0] ?? null
  })
}

export async function queueOwnedRiskJob(
  db: IntakeDrizzleDatabase,
  jobId: string,
  workerId: string,
  patch: {
    readonly availableAt: Date
    readonly lastError: string | null
    readonly updatedAt: Date
  },
): Promise<RiskJobRecord | null> {
  const rows = await db
    .update(riskJobs)
    .set({
      ...patch,
      status: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(riskJobs.id, jobId),
        eq(riskJobs.status, 'processing'),
        eq(riskJobs.leaseOwner, workerId),
        gt(riskJobs.leaseExpiresAt, patch.updatedAt),
      ),
    )
    .returning()
  return rows[0] ?? null
}

export function readQueueDuration(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const duration = value ?? fallback
  if (!Number.isSafeInteger(duration) || duration < 0) {
    throw new RangeError(`${name} must be a non-negative integer`)
  }
  return duration
}

export function readQueueLimit(value: number | undefined): number {
  const limit = value ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('limit must be an integer from 1 through 500')
  }
  return limit
}
