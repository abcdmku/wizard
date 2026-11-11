import { FulfillmentContextSchema } from '@fulfillment/domain'
import type { Pool, PoolClient } from 'pg'
import type { CreateRecordResult, NewOrderRecord, OrderCatalog, OrderRecord } from '../catalog'

interface DatabaseOrderRow {
  order_id: string
  tenant_id: string
  customer_id: string
  status: string
  active: boolean
  create_idempotency_key: string
  request_digest: string
  initial_context: unknown
  created_at: Date
  updated_at: Date
}

const columns = `order_id, tenant_id, customer_id, status, active,
  create_idempotency_key, request_digest, initial_context, created_at, updated_at`

export class PostgresOrderCatalog implements OrderCatalog {
  constructor(private readonly pool: Pool) {}

  async create(record: NewOrderRecord): Promise<CreateRecordResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query<DatabaseOrderRow>(
        `INSERT INTO fulfillment_orders (${columns})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (tenant_id, customer_id, create_idempotency_key) DO NOTHING
         RETURNING ${columns}`,
        values(record),
      )
      const insertedRow = inserted.rows[0]
      if (insertedRow !== undefined) {
        await client.query('COMMIT')
        return { kind: 'created', record: mapRow(insertedRow) }
      }
      const existing = await findIdempotent(client, record)
      await client.query('COMMIT')
      if (existing === undefined || existing.requestDigest !== record.requestDigest) {
        return { kind: 'conflict' }
      }
      return { kind: 'replayed', record: existing }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async get(orderId: string): Promise<OrderRecord | undefined> {
    const result = await this.pool.query<DatabaseOrderRow>(
      `SELECT ${columns} FROM fulfillment_orders WHERE order_id = $1`,
      [orderId],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : mapRow(row)
  }

  async list(tenantId: string, customerId?: string): Promise<readonly OrderRecord[]> {
    const result = await this.pool.query<DatabaseOrderRow>(
      `SELECT ${columns} FROM fulfillment_orders
       WHERE tenant_id = $1 AND ($2::text IS NULL OR customer_id = $2)
       ORDER BY updated_at DESC LIMIT 100`,
      [tenantId, customerId ?? null],
    )
    return result.rows.map(mapRow)
  }

  async listActive(): Promise<readonly OrderRecord[]> {
    const result = await this.pool.query<DatabaseOrderRow>(
      `SELECT ${columns} FROM fulfillment_orders WHERE active = true ORDER BY created_at`,
    )
    return result.rows.map(mapRow)
  }

  async updateRuntime(
    orderId: string,
    status: string,
    active: boolean,
    updatedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE fulfillment_orders SET status = $2, active = $3, updated_at = $4
       WHERE order_id = $1`,
      [orderId, status, active, updatedAt],
    )
  }

  async recordCallback(input: {
    readonly eventId: string
    readonly orderId: string
    readonly partner: string
    readonly digest: string
    readonly outcome: string
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO fulfillment_callback_audit
         (event_id, order_id, partner, digest, outcome)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (order_id, partner, event_id) DO UPDATE SET outcome = EXCLUDED.outcome`,
      [input.eventId, input.orderId, input.partner, input.digest, input.outcome],
    )
  }
}

async function findIdempotent(client: PoolClient, record: NewOrderRecord) {
  const result = await client.query<DatabaseOrderRow>(
    `SELECT ${columns} FROM fulfillment_orders
     WHERE tenant_id = $1 AND customer_id = $2 AND create_idempotency_key = $3
     FOR UPDATE`,
    [record.tenantId, record.customerId, record.createIdempotencyKey],
  )
  const row = result.rows[0]
  return row === undefined ? undefined : mapRow(row)
}

function values(record: NewOrderRecord): unknown[] {
  return [
    record.orderId,
    record.tenantId,
    record.customerId,
    record.status,
    record.active,
    record.createIdempotencyKey,
    record.requestDigest,
    JSON.stringify(record.initialContext),
    record.createdAt,
    record.updatedAt,
  ]
}

function mapRow(row: DatabaseOrderRow): OrderRecord {
  return {
    orderId: row.order_id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    status: row.status,
    active: row.active,
    createIdempotencyKey: row.create_idempotency_key,
    requestDigest: row.request_digest,
    initialContext: FulfillmentContextSchema.parse(row.initial_context),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}
