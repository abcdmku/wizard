import { randomUUID } from 'node:crypto'
import {
  CreateOrderSchema,
  CustomerOrderResponseSchema,
  fulfillmentRoutes,
  type OperatorOrder,
  OperatorOrderListResponseSchema,
  PartnerCallbackSchema,
} from '@fulfillment/contracts'
import { describe, expect, it } from 'vitest'
import { shipmentSucceeded } from './support/fulfillment'
import {
  auth,
  integrationReady,
  orchestratorUrl,
  parseBody,
  replaceId,
  requestJson,
  route,
  tokens,
} from './support/http'
import { rawCallback, signedHeaders } from './support/webhook'

const callbackPath = fulfillmentRoutes.partnerWebhook
const orderInput = CreateOrderSchema.parse({
  currency: 'USD',
  lines: [{ sku: 'WEBHOOK-TEST', name: 'Webhook test item', quantity: 1, unitPriceMinor: 4200 }],
  shippingAddress: {
    recipient: 'Webhook QA',
    line1: '1 Callback Way',
    city: 'Austin',
    region: 'TX',
    postalCode: '99999',
    country: 'US',
  },
})

function callbackFor(orderId: string, tenantId: string) {
  return PartnerCallbackSchema.parse({
    ...shipmentSucceeded(),
    eventId: `evt-webhook-${orderId}`,
    orderId,
    tenantId,
  })
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function discoverOrder(): Promise<string> {
  const created = await requestJson(route('customerOrders'), {
    method: 'POST',
    headers: { ...auth(tokens.acmeCustomer), 'idempotency-key': `webhook-${randomUUID()}` },
    body: JSON.stringify(orderInput),
  })
  expect([200, 201]).toContain(created.response.status)
  const response = parseBody(created.body, CustomerOrderResponseSchema)
  return response.order.id
}

async function waitForOperatorOrder(
  orderId: string,
  statuses: readonly OperatorOrder['status'][],
): Promise<OperatorOrder> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const listed = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.acmeOperator),
    })
    expect(listed.response.status).toBe(200)
    const orders = parseBody(listed.body, OperatorOrderListResponseSchema).orders
    const order = orders.find((candidate) => candidate.id === orderId)
    if (order !== undefined && statuses.includes(order.status)) return order
    await delay(250)
  }
  throw new Error(`Order ${orderId} did not reach shipping before the callback test deadline`)
}

async function prepareShippingOrder(): Promise<string> {
  const orderId = await discoverOrder()
  const current = await waitForOperatorOrder(orderId, ['fraud_review', 'shipping', 'shipped'])
  if (current.status === 'fraud_review') {
    const approved = await requestJson(replaceId(route('operatorFraudApprove'), orderId), {
      method: 'POST',
      headers: {
        ...auth(tokens.acmeOperator),
        'idempotency-key': `webhook-approve-${randomUUID()}`,
      },
      body: JSON.stringify({ note: 'prepared by webhook integration test' }),
    })
    expect(approved.response.status).toBe(200)
  }
  const shipping = await waitForOperatorOrder(orderId, ['shipping', 'shipped'])
  return shipping.id
}

describe.skipIf(!integrationReady)('signed partner webhook', () => {
  it('rejects an invalid signature and stale timestamp before resolving a run', async () => {
    const orderId = await discoverOrder()
    const callback = callbackFor(orderId, 'tenant-acme')
    const body = rawCallback(callback)
    const invalid = await fetch(`${orchestratorUrl}${callbackPath}`, {
      method: 'POST',
      headers: { ...signedHeaders(body, 'shipping'), 'x-fulfillment-signature': 'v1=bad' },
      body,
    })
    expect(invalid.status).toBe(401)

    const stale = await fetch(`${orchestratorUrl}${callbackPath}`, {
      method: 'POST',
      headers: signedHeaders(body, 'shipping', Math.floor(Date.now() / 1_000) - 3_600),
      body,
    })
    expect(stale.status).toBe(401)
  })

  it('accepts the exact raw callback and acknowledges duplicate delivery', async () => {
    const orderId = await prepareShippingOrder()
    const callback = callbackFor(orderId, 'tenant-acme')
    const body = rawCallback(callback)
    const headers = signedHeaders(body, 'shipping')
    const first = await fetch(`${orchestratorUrl}${callbackPath}`, {
      method: 'POST',
      headers,
      body,
    })
    expect(first.status).toBe(202)
    const second = await fetch(`${orchestratorUrl}${callbackPath}`, {
      method: 'POST',
      headers,
      body,
    })
    expect(second.status).toBe(200)
    const duplicate: unknown = await second.json()
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true })
  })

  it('rejects malformed signed JSON and a callback for another tenant', async () => {
    const malformed = '{"type":"shipping.shipment.succeeded"'
    const malformedResponse = await fetch(`${orchestratorUrl}${callbackPath}`, {
      method: 'POST',
      headers: signedHeaders(malformed, 'shipping'),
      body: malformed,
    })
    expect([400, 422]).toContain(malformedResponse.status)

    const orderId = await discoverOrder()
    const callback = callbackFor(orderId, 'tenant-globex')
    const body = rawCallback(callback)
    const response = await requestJson(callbackPath, {
      method: 'POST',
      headers: signedHeaders(body, 'shipping'),
      body,
    })
    expect([403, 404, 409, 422]).toContain(response.response.status)
    expect(JSON.stringify(response.body)).not.toContain('trackingUrl')
  })
})
