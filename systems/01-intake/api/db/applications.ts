import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { type ApplicationRecord, applications, type NewApplicationRecord } from './schema'
import type { IntakeDrizzleDatabase } from './types'

export type CreateApplicationInput = Pick<
  NewApplicationRecord,
  'id' | 'tenantId' | 'applicantId' | 'applicantName'
>

export interface ListApplicationsInput {
  readonly tenantId: string
  readonly applicantId?: string
  readonly limit?: number
}

export interface ListActiveApplicationsInput {
  readonly afterId?: string
  readonly limit?: number
}

export interface ApplicationRepository {
  create(input: CreateApplicationInput): Promise<ApplicationRecord>
  get(tenantId: string, id: string): Promise<ApplicationRecord | null>
  getById(id: string): Promise<ApplicationRecord | null>
  list(input: ListApplicationsInput): Promise<readonly ApplicationRecord[]>
  listActive(input?: ListActiveApplicationsInput): Promise<readonly ApplicationRecord[]>
  touch(tenantId: string, id: string): Promise<ApplicationRecord | null>
  markTerminal(tenantId: string, id: string, terminalAt?: Date): Promise<ApplicationRecord | null>
  markActive(tenantId: string, id: string): Promise<ApplicationRecord | null>
  deleteTenant(tenantId: string): Promise<number>
}

export function createApplicationRepository(db: IntakeDrizzleDatabase): ApplicationRepository {
  return {
    async create(input) {
      const rows = await db.insert(applications).values(input).returning()
      return requireRow(rows[0], 'application insert returned no row')
    },

    async get(tenantId, id) {
      const rows = await db
        .select()
        .from(applications)
        .where(and(eq(applications.tenantId, tenantId), eq(applications.id, id)))
        .limit(1)
      return rows[0] ?? null
    },

    async getById(id) {
      const rows = await db.select().from(applications).where(eq(applications.id, id)).limit(1)
      return rows[0] ?? null
    },

    async list(input) {
      const limit = readLimit(input.limit, 100)
      const condition =
        input.applicantId === undefined
          ? eq(applications.tenantId, input.tenantId)
          : and(
              eq(applications.tenantId, input.tenantId),
              eq(applications.applicantId, input.applicantId),
            )
      return db
        .select()
        .from(applications)
        .where(condition)
        .orderBy(desc(applications.updatedAt))
        .limit(limit)
    },

    async listActive(input = {}) {
      const condition =
        input.afterId === undefined
          ? isNull(applications.terminalAt)
          : and(isNull(applications.terminalAt), gt(applications.id, input.afterId))
      return db
        .select()
        .from(applications)
        .where(condition)
        .orderBy(asc(applications.id))
        .limit(readLimit(input.limit, 100))
    },

    async touch(tenantId, id) {
      const rows = await db
        .update(applications)
        .set({ updatedAt: new Date() })
        .where(and(eq(applications.tenantId, tenantId), eq(applications.id, id)))
        .returning()
      return rows[0] ?? null
    },

    async markTerminal(tenantId, id, terminalAt = new Date()) {
      return updateLifecycle(db, tenantId, id, terminalAt)
    },

    async markActive(tenantId, id) {
      return updateLifecycle(db, tenantId, id, null)
    },

    async deleteTenant(tenantId) {
      const rows = await db
        .delete(applications)
        .where(eq(applications.tenantId, tenantId))
        .returning({ id: applications.id })
      return rows.length
    },
  }
}

async function updateLifecycle(
  db: IntakeDrizzleDatabase,
  tenantId: string,
  id: string,
  terminalAt: Date | null,
): Promise<ApplicationRecord | null> {
  const rows = await db
    .update(applications)
    .set({ terminalAt, updatedAt: new Date() })
    .where(and(eq(applications.tenantId, tenantId), eq(applications.id, id)))
    .returning()
  return rows[0] ?? null
}

function readLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('limit must be an integer from 1 through 500')
  }
  return limit
}

function requireRow<Row>(row: Row | undefined, message: string): Row {
  if (row === undefined) throw new Error(message)
  return row
}
