import { FulfillmentContextSchema, type FulfillmentDependencies } from '@fulfillment/domain'
import { createMemoryDurableStore } from '@openwizard/durable'
import { describe, expect, it } from 'vitest'
import { inventoryReserved, paymentAuthorized } from '../../../tests/support/fulfillment'
import { FulfillmentApplicationService } from './application-service'
import type { CreateRecordResult, NewOrderRecord, OrderCatalog, OrderRecord } from './catalog'
import { loadConfig } from './config'
import { DurableOrderRegistry } from './registry'
import { createOrchestratorApp } from './server'

const now = '2026-08-23T12:00:00.000Z'

function orderRecord(): OrderRecord {
  const initialContext = FulfillmentContextSchema.parse({
    orderId: 'd4e6eb25-3553-475b-9d05-d025a1314120',
    tenantId: 'tenant-acme',
    customerId: 'customer-alice',
    currency: 'USD',
    totalMinor: 5_100,
    lines: [{ sku: 'REGISTRY-WAND', name: 'Registry wand', quantity: 1, unitPriceMinor: 5_100 }],
    shippingAddress: {
      recipient: 'Alice',
      line1: '1 Durable Way',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
    },
    callbackUrl: 'https://fulfillment.example/api/webhooks/partner',
    createdAt: now,
    updatedAt: now,
    paymentAuthorization: { state: 'pending' },
    inventoryReservation: { state: 'pending' },
    paymentCapture: { state: 'idle' },
    fraud: { state: 'pending' },
    shipment: { state: 'idle' },
  })
  return {
    orderId: initialContext.orderId,
    tenantId: initialContext.tenantId,
    customerId: initialContext.customerId,
    status: 'processing',
    active: true,
    createIdempotencyKey: 'registry-test',
    requestDigest: 'digest',
    initialContext,
    createdAt: now,
    updatedAt: now,
  }
}

function dependencies(): FulfillmentDependencies {
  const accepted = (requestId: string) =>
    Promise.resolve({ accepted: true as const, requestId, duplicate: false })
  return {
    now: () => now,
    gateway: {
      authorizePayment: () => accepted('authorize'),
      reserveInventory: () => accepted('inventory'),
      capturePayment: () => accepted('capture'),
      createShipment: () => accepted('shipment'),
      voidAuthorization: () => Promise.resolve(),
      releaseInventory: () => Promise.resolve(),
      refundPayment: () => Promise.resolve(),
      cancelShipment: () => Promise.resolve(),
    },
  }
}

class FakeCatalog implements OrderCatalog {
  readonly updates: string[] = []

  constructor(private readonly records: readonly OrderRecord[] = []) {}

  create(_record: NewOrderRecord): Promise<CreateRecordResult> {
    return Promise.resolve({ kind: 'conflict' })
  }

  get(orderId: string): Promise<OrderRecord | undefined> {
    return Promise.resolve(this.records.find((record) => record.orderId === orderId))
  }

  list(tenantId: string, customerId?: string): Promise<readonly OrderRecord[]> {
    return Promise.resolve(
      this.records.filter(
        (record) =>
          record.tenantId === tenantId &&
          (customerId === undefined || record.customerId === customerId),
      ),
    )
  }

  listActive(): Promise<readonly OrderRecord[]> {
    return Promise.resolve(this.records.filter((record) => record.active))
  }

  updateRuntime(orderId: string): Promise<void> {
    this.updates.push(orderId)
    return Promise.resolve()
  }

  recordCallback(): Promise<void> {
    return Promise.resolve()
  }
}

describe('DurableOrderRegistry', () => {
  it('single-flights hosts and remains closed after disposal', async () => {
    const catalog = new FakeCatalog()
    const registry = new DurableOrderRegistry({
      store: createMemoryDurableStore(),
      catalog,
      deps: dependencies(),
      ownerId: 'registry-test-owner',
      leaseTtlMs: 1_000,
      renewEveryMs: 250,
    })
    const record = orderRecord()

    const [first, second] = await Promise.all([registry.open(record), registry.open(record)])

    expect(first).toBe(second)
    expect(catalog.updates).toEqual([record.orderId])
    await registry.disposeAll()
    await expect(registry.open(record)).rejects.toMatchObject({
      code: 'WORKFLOW_BUSY',
      statusCode: 503,
    })
  })

  it('keeps the Globex operator queue and detail tenant-isolated', async () => {
    const acmeOrder = orderRecord()
    const catalog = new FakeCatalog([acmeOrder])
    const registry = new DurableOrderRegistry({
      store: createMemoryDurableStore(),
      catalog,
      deps: dependencies(),
      ownerId: 'operator-isolation-owner',
      leaseTtlMs: 1_000,
      renewEveryMs: 250,
    })
    const service = new FulfillmentApplicationService({
      catalog,
      registry,
      callbackUrl: 'https://fulfillment.example/api/webhooks/partner',
    })
    const config = loadConfig({ DATABASE_URL: 'postgres://test' })
    const app = createOrchestratorApp({
      service,
      authTokens: config.authTokens,
      webhookSecrets: {
        payment: 'payment-test-secret',
        inventory: 'inventory-test-secret',
        shipping: 'shipping-test-secret',
      },
      seedKey: 'test-seed-key',
      healthCheck: () => Promise.resolve(),
    })

    try {
      const headers = { authorization: 'Bearer operator-globex' }
      const list = await app.inject({ method: 'GET', url: '/api/operator/orders', headers })
      const detail = await app.inject({
        method: 'GET',
        url: `/api/operator/orders/${acmeOrder.orderId}`,
        headers,
      })

      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual({ orders: [] })
      expect(detail.statusCode).toBe(404)
      expect(detail.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    } finally {
      await app.close()
      await registry.disposeAll()
    }
  })

  it('replays a fraud decision and rejects changed data or a second decision', async () => {
    const record = orderRecord()
    const catalog = new FakeCatalog([record])
    const registry = new DurableOrderRegistry({
      store: createMemoryDurableStore(),
      catalog,
      deps: dependencies(),
      ownerId: 'fraud-replay-owner',
      leaseTtlMs: 1_000,
      renewEveryMs: 250,
    })
    const service = new FulfillmentApplicationService({
      catalog,
      registry,
      callbackUrl: record.initialContext.callbackUrl,
      now: () => now,
    })
    const principal = {
      tenantId: record.tenantId,
      subjectId: 'operator-olivia',
      role: 'operator',
    } as const

    try {
      const host = await registry.open(record)
      expect(await host.dispatch({ type: 'start' }, { commandId: 'start' })).toMatchObject({
        ok: true,
        result: { ok: true },
      })
      expect(
        await host.send('payment.authorization.succeeded', paymentAuthorized(record.orderId), {
          eventId: 'authorization',
        }),
      ).toMatchObject({ ok: true })
      expect(
        await host.send('inventory.reservation.succeeded', inventoryReserved(record.orderId), {
          eventId: 'inventory',
        }),
      ).toMatchObject({ ok: true })
      await expect.poll(() => host.run.getState().steps.waitFraudReview.status).toBe('active')

      const approval = service.reviewFraud(
        principal,
        record.orderId,
        { decision: 'approve' },
        'decision-1',
      )
      await expect(
        service.reviewFraud(principal, record.orderId, { decision: 'approve' }, 'decision-race'),
      ).rejects.toMatchObject({ code: 'WORKFLOW_BUSY', statusCode: 409 })
      const approved = await approval
      expect(approved.fraud.state).toBe('approved')
      await expect.poll(() => host.run.getState().steps.waitPaymentCapture.status).toBe('active')
      const seq = host.run.getState().seq
      const replayed = await service.reviewFraud(
        principal,
        record.orderId,
        { decision: 'approve' },
        'decision-1',
      )
      expect(replayed.fraud.state).toBe('approved')
      expect(host.run.getState().seq).toBe(seq)

      await expect(
        service.reviewFraud(principal, record.orderId, { decision: 'reject' }, 'decision-1'),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
        statusCode: 409,
      })
      await expect(
        service.reviewFraud(principal, record.orderId, { decision: 'approve' }, 'decision-2'),
      ).rejects.toMatchObject({
        code: 'INVALID_OPERATION',
        statusCode: 409,
      })
    } finally {
      await registry.disposeAll()
    }
  })
})
