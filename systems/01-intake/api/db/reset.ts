import { eq, sql } from 'drizzle-orm'
import { applications } from './schema'
import type { IntakeDrizzleDatabase } from './types'

export interface TenantResetResult {
  readonly applicationsDeleted: number
  readonly durableRunsDeleted: number
}

export function intakeRunKeyPrefix(tenantId: string): string {
  return `intake:${encodeURIComponent(tenantId)}:`
}

export function intakeRunKey(tenantId: string, applicationId: string): string {
  return `${intakeRunKeyPrefix(tenantId)}${encodeURIComponent(applicationId)}`
}

export async function resetTenantData(
  db: IntakeDrizzleDatabase,
  tenantId: string,
): Promise<TenantResetResult> {
  const runPrefix = intakeRunKeyPrefix(tenantId)
  return db.transaction(async (tx) => {
    const durableRuns = await tx.execute(
      sql<{ runKey: string }>`
        delete from intake_wizard_runs
        where starts_with(run_key, ${runPrefix})
        returning run_key as "runKey"
      `,
    )
    const deletedApplications = await tx
      .delete(applications)
      .where(eq(applications.tenantId, tenantId))
      .returning({ id: applications.id })
    return {
      applicationsDeleted: deletedApplications.length,
      durableRunsDeleted: durableRuns.length,
    }
  })
}
