import { definePgDurableSchema } from '@openwizard/drizzle/pg'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { RiskOutcome } from '../../shared/common.js'
import type { RiskInput } from '../../shared/domain.js'

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type RiskJobStatus = 'queued' | 'processing' | 'completed'
export type RiskReviewInput = RiskInput
export type RiskReviewOutcome = RiskOutcome

export const durableSchema = definePgDurableSchema({ tablePrefix: 'intake_wizard_' })

export const applications = pgTable(
  'intake_applications',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicantId: text('applicant_id').notNull(),
    applicantName: text('applicant_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('intake_applications_tenant_id_id_unique').on(table.tenantId, table.id),
    index('intake_applications_tenant_applicant_idx').on(table.tenantId, table.applicantId),
    index('intake_applications_active_idx').on(table.terminalAt, table.id),
  ],
)

export const riskJobs = pgTable(
  'intake_risk_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: text('application_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').$type<RiskJobStatus>().notNull().default('queued'),
    input: jsonb('input').$type<RiskReviewInput>().notNull(),
    score: integer('score'),
    outcome: text('outcome').$type<RiskReviewOutcome>(),
    reasons: jsonb('reasons').$type<readonly string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }).onDelete('cascade'),
    uniqueIndex('intake_risk_jobs_fingerprint_unique').on(
      table.tenantId,
      table.applicationId,
      table.fingerprint,
    ),
    index('intake_risk_jobs_claim_idx').on(table.status, table.availableAt, table.leaseExpiresAt),
    index('intake_risk_jobs_delivery_idx').on(table.status, table.deliveredAt, table.completedAt),
    check(
      'intake_risk_jobs_status_check',
      sql`${table.status} in ('queued', 'processing', 'completed')`,
    ),
    check(
      'intake_risk_jobs_outcome_check',
      sql`${table.outcome} is null or ${table.outcome} in ('approved', 'rejected', 'manual-review')`,
    ),
    check('intake_risk_jobs_attempt_count_check', sql`${table.attemptCount} >= 0`),
  ],
)

export const auditEvents = pgTable(
  'intake_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    data: jsonb('data').$type<JsonValue>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }).onDelete('cascade'),
    index('intake_audit_events_application_idx').on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
  ],
)

export const databaseSchema = {
  ...durableSchema,
  applications,
  auditEvents,
  riskJobs,
}

export type ApplicationRecord = typeof applications.$inferSelect
export type NewApplicationRecord = typeof applications.$inferInsert
export type RiskJobRecord = typeof riskJobs.$inferSelect
export type NewRiskJobRecord = typeof riskJobs.$inferInsert
export type AuditEventRecord = typeof auditEvents.$inferSelect
export type NewAuditEventRecord = typeof auditEvents.$inferInsert
