import { and, asc, eq } from 'drizzle-orm'
import {
  type AuditEventRecord,
  auditEvents,
  type JsonValue,
  type NewAuditEventRecord,
} from './schema'
import type { IntakeDrizzleDatabase } from './types'

export type RecordAuditEventInput = Pick<
  NewAuditEventRecord,
  'tenantId' | 'applicationId' | 'actor' | 'action'
> & {
  readonly data: JsonValue
}

export interface AuditRepository {
  record(input: RecordAuditEventInput): Promise<AuditEventRecord>
  list(
    tenantId: string,
    applicationId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly AuditEventRecord[]>
}

export function createAuditRepository(db: IntakeDrizzleDatabase): AuditRepository {
  return {
    async record(input) {
      const rows = await db.insert(auditEvents).values(input).returning()
      const row = rows[0]
      if (row === undefined) throw new Error('audit event insert returned no row')
      return row
    },

    async list(tenantId, applicationId, options) {
      return db
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.applicationId, applicationId)),
        )
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
        .limit(readLimit(options?.limit))
    },
  }
}

function readLimit(value: number | undefined): number {
  const limit = value ?? 250
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError('limit must be an integer from 1 through 1000')
  }
  return limit
}
