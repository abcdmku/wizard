import type { DurableStore } from '@openwizard/durable/store'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Sql } from 'postgres'
import type { ApplicationRepository } from './applications'
import type { AuditRepository } from './audit'
import type { TenantResetResult } from './reset'
import type { RiskJobQueue } from './risk-queue'
import type { databaseSchema } from './schema'

export type IntakeSqlClient = Sql<Record<string, never>>
export type IntakeDrizzleDatabase = PostgresJsDatabase<typeof databaseSchema>

export interface IntakeDatabase {
  readonly client: IntakeSqlClient
  readonly db: IntakeDrizzleDatabase
  readonly durableStore: DurableStore
  readonly applications: ApplicationRepository
  readonly riskJobs: RiskJobQueue
  readonly audit: AuditRepository
  ensureSchema(): Promise<void>
  resetTenant(tenantId: string): Promise<TenantResetResult>
  close(): Promise<void>
}
