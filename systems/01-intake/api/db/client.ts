import { createPgDrizzleDurableStore } from '@openwizard/drizzle/pg'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { createApplicationRepository } from './applications'
import { createAuditRepository } from './audit'
import { ensureIntakeSchema } from './migrate'
import { resetTenantData } from './reset'
import { createRiskJobQueue, type RiskJobQueueOptions } from './risk-queue'
import { databaseSchema, durableSchema } from './schema'
import type { IntakeDatabase, IntakeSqlClient } from './types'

export interface CreateIntakeDatabaseOptions extends RiskJobQueueOptions {
  readonly connectionString?: string
  readonly maxConnections?: number
  readonly idleTimeoutSeconds?: number
  readonly connectTimeoutSeconds?: number
}

export function createIntakeDatabase(options: CreateIntakeDatabaseOptions = {}): IntakeDatabase {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL or connectionString is required')
  }

  const client: IntakeSqlClient = postgres(connectionString, {
    max: readPositiveInteger(options.maxConnections, 10, 'maxConnections'),
    idle_timeout: readPositiveInteger(options.idleTimeoutSeconds, 20, 'idleTimeoutSeconds'),
    connect_timeout: readPositiveInteger(
      options.connectTimeoutSeconds,
      10,
      'connectTimeoutSeconds',
    ),
  })
  const db = drizzle(client, { schema: databaseSchema })
  const applications = createApplicationRepository(db)
  const riskJobs = createRiskJobQueue(db, options)
  const audit = createAuditRepository(db)
  // dx-audit: as-unknown -- pnpm gives the app and adapter separate Drizzle peer instances
  const durableDatabase = db as unknown as Parameters<typeof createPgDrizzleDurableStore>[0]
  const durableStore = createPgDrizzleDurableStore(durableDatabase, durableSchema)
  let closed = false

  return {
    client,
    db,
    durableStore,
    applications,
    riskJobs,
    audit,
    ensureSchema: () => ensureIntakeSchema(db),
    resetTenant: (tenantId) => resetTenantData(db, tenantId),
    async close() {
      if (closed) return
      closed = true
      await client.end({ timeout: 5 })
    },
  }
}

function readPositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new RangeError(`${name} must be a positive integer`)
  }
  return result
}
