import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { CreateOrderSchema, CustomerOrderResponseSchema } from '@fulfillment/contracts'
import { describe, expect, it } from 'vitest'
import { auth, integrationReady, parseBody, requestJson, route, tokens } from './support/http'

const execFileAsync = promisify(execFile)
const systemRoot = fileURLToPath(new URL('..', import.meta.url))
const input = CreateOrderSchema.parse({
  currency: 'USD',
  lines: [{ sku: 'DATABASE-TEST', name: 'Database test item', quantity: 1, unitPriceMinor: 4200 }],
  shippingAddress: {
    recipient: 'Database QA',
    line1: '1 Durable Way',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  },
})

async function sql(statement: string): Promise<string> {
  const result = await execFileAsync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.FULFILLMENT_DB_USER ?? 'fulfillment',
      '-d',
      process.env.FULFILLMENT_DB_NAME ?? 'fulfillment',
      '-At',
      '-c',
      statement,
    ],
    { cwd: systemRoot },
  )
  return result.stdout.trim()
}

async function createOrder(): Promise<string> {
  const response = await requestJson(route('customerOrders'), {
    method: 'POST',
    headers: { ...auth(tokens.acmeCustomer), 'idempotency-key': `database-${randomUUID()}` },
    body: JSON.stringify(input),
  })
  expect([200, 201]).toContain(response.response.status)
  return parseBody(response.body, CustomerOrderResponseSchema).order.id
}

async function waitForCallback(orderId: string): Promise<string> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const eventId = await sql(
      `SELECT event_id FROM fulfillment_callback_audit WHERE order_id = '${orderId}' ORDER BY event_id LIMIT 1`,
    )
    if (eventId.length > 0) return eventId
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No partner callback audit row appeared for ${orderId}`)
}

describe.skipIf(!integrationReady)('Postgres persistence', () => {
  it('runs migrations against the real Compose database', async () => {
    await expect(sql('SELECT 1')).resolves.toBe('1')
    const tables = await sql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fulfillment_%' ORDER BY table_name",
    )
    expect(tables).toContain('fulfillment_orders')
    expect(tables).toContain('fulfillment_callback_audit')
    expect(tables).toContain('fulfillment_wizard_runs')
    expect(tables).toContain('fulfillment_wizard_dedupe')
  })

  it('keeps a created order and its run snapshot tenant-scoped', async () => {
    const orderId = await createOrder()
    const owner = await sql(
      `SELECT tenant_id FROM fulfillment_orders WHERE order_id = '${orderId}'::uuid`,
    )
    expect(owner).toBe('tenant-acme')
    const foreign = await sql(
      `SELECT count(*) FROM fulfillment_orders WHERE order_id = '${orderId}'::uuid AND tenant_id = 'tenant-globex'`,
    )
    expect(foreign).toBe('0')
  })

  it('records real callback delivery once when the same audit event is written again', async () => {
    const orderId = await createOrder()
    const eventId = await waitForCallback(orderId)
    const before = await sql(
      `SELECT count(*) FROM fulfillment_callback_audit WHERE event_id = '${eventId.replaceAll("'", "''")}'`,
    )
    expect(before).toBe('1')
    await sql(
      `INSERT INTO fulfillment_callback_audit (event_id, order_id, partner, digest, outcome) SELECT event_id, order_id, partner, digest, outcome FROM fulfillment_callback_audit WHERE event_id = '${eventId.replaceAll("'", "''")}' ON CONFLICT (order_id, partner, event_id) DO UPDATE SET outcome = EXCLUDED.outcome`,
    )
    const after = await sql(
      `SELECT count(*) FROM fulfillment_callback_audit WHERE event_id = '${eventId.replaceAll("'", "''")}'`,
    )
    expect(after).toBe('1')
    const duplicateConstraint = await sql(
      "SELECT count(*) FROM pg_constraint WHERE conname = 'fulfillment_callback_audit_pkey'",
    )
    expect(duplicateConstraint).toBe('1')
  })
})
