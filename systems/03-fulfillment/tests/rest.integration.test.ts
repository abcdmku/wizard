import { randomUUID } from 'node:crypto'
import {
  CreateOrderSchema,
  CustomerOrderResponseSchema,
  FraudDecisionSchema,
  OperatorOrderListResponseSchema,
} from '@fulfillment/contracts'
import { describe, expect, it } from 'vitest'
import {
  auth,
  errorCode,
  integrationReady,
  parseBody,
  replaceId,
  requestJson,
  route,
  tokens,
} from './support/http'

const input = CreateOrderSchema.parse({
  currency: 'USD',
  lines: [{ sku: 'sku-rest-1', name: 'Notebook', quantity: 1, unitPriceMinor: 4200 }],
  shippingAddress: {
    recipient: 'Jordan Lee',
    line1: '1 Main Street',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  },
})

async function createOrder(keyPrefix: string, token = tokens.acmeCustomer): Promise<string> {
  const response = await requestJson(route('customerOrders'), {
    method: 'POST',
    headers: { ...auth(token), 'idempotency-key': `${keyPrefix}-${randomUUID()}` },
    body: JSON.stringify(input),
  })
  expect([200, 201]).toContain(response.response.status)
  return parseBody(response.body, CustomerOrderResponseSchema).order.id
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function fraudOrder(): Promise<string> {
  const configured = process.env.FULFILLMENT_FRAUD_ORDER_ID
  const orderId = configured ?? (await createOrder('rest-fraud'))
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const listed = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.acmeOperator),
    })
    expect(listed.response.status).toBe(200)
    const orders = parseBody(listed.body, OperatorOrderListResponseSchema).orders
    const order = orders.find((candidate) => candidate.id === orderId)
    if (order?.status === 'fraud_review') return orderId
    if (
      order?.status === 'shipped' ||
      order?.status === 'failed' ||
      order?.status === 'cancelled'
    ) {
      throw new Error(`Order ${orderId} reached ${order.status} before fraud review`)
    }
    await delay(250)
  }
  throw new Error(`Order ${orderId} did not reach fraud review before the REST test deadline`)
}

async function waitForCancellation(orderId: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await requestJson(replaceId(route('customerOrder'), orderId), {
      headers: auth(tokens.acmeCustomer),
    })
    expect(response.response.status).toBe(200)
    const order = parseBody(response.body, CustomerOrderResponseSchema).order
    if (order.status === 'cancelled') return
    if (order.status === 'failed') throw new Error(`Order ${orderId} failed during compensation`)
    await delay(250)
  }
  throw new Error(`Order ${orderId} did not finish cancellation before the REST test deadline`)
}

describe.skipIf(!integrationReady)('fulfillment REST boundary', () => {
  it('serves health without an application token', async () => {
    const { response, body } = await requestJson(route('health'))
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'ok' })
  })

  it('rejects missing and malformed authentication before resolving an order', async () => {
    const missing = await requestJson(route('customerOrders'))
    expect(missing.response.status).toBe(401)

    const malformed = await requestJson(route('customerOrders'), {
      headers: { authorization: 'Bearer not-a-seed-token' },
    })
    expect(malformed.response.status).toBe(401)
    expect(errorCode(malformed.body)).toMatch(/AUTH|TOKEN|UNAUTHORIZED/i)
  })

  it('creates an order and returns only the customer projection', async () => {
    const orderId = await createOrder('rest-projection')
    const created = await requestJson(replaceId(route('customerOrder'), orderId), {
      headers: auth(tokens.acmeCustomer),
    })
    expect(created.response.status).toBe(200)
    const response = parseBody(created.body, CustomerOrderResponseSchema)
    const wire = JSON.stringify(response.order)
    expect(wire).toContain(response.order.id)
    expect(wire).not.toContain('tenantId')
    expect(wire).not.toContain('callbackUrl')
    expect(wire).not.toContain('workflow')
    expect(wire).not.toContain('paymentAuthorization')
  })

  it('returns 400 for malformed JSON and 404 for a cross-tenant order', async () => {
    const malformed = await requestJson(route('customerOrders'), {
      method: 'POST',
      headers: {
        ...auth(tokens.acmeCustomer),
        'idempotency-key': `rest-malformed-${randomUUID()}`,
      },
      body: '{"currency":',
    })
    expect(malformed.response.status).toBe(400)

    const orderId = await createOrder('rest-cross-tenant')
    const crossTenant = await requestJson(replaceId(route('customerOrder'), orderId), {
      headers: auth(tokens.globexCustomer),
    })
    expect(crossTenant.response.status).toBe(404)
    expect(JSON.stringify(crossTenant.body)).not.toContain(orderId)
  })

  it('isolates operator lists and details by tenant', async () => {
    const acmeOrderId = await createOrder('rest-operator-acme')
    const globexOrderId = await createOrder('rest-operator-globex', tokens.globexCustomer)
    const acmeList = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.acmeOperator),
    })
    expect(acmeList.response.status).toBe(200)
    const acmeOrders = parseBody(acmeList.body, OperatorOrderListResponseSchema).orders
    expect(acmeOrders.map((order) => order.id)).toContain(acmeOrderId)
    expect(acmeOrders.map((order) => order.id)).not.toContain(globexOrderId)

    const globexList = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.globexOperator),
    })
    expect(globexList.response.status).toBe(200)
    const globexOrders = parseBody(globexList.body, OperatorOrderListResponseSchema).orders
    expect(globexOrders.map((order) => order.id)).toContain(globexOrderId)
    expect(globexOrders.map((order) => order.id)).not.toContain(acmeOrderId)

    const acmeForeign = await requestJson(replaceId(route('operatorOrder'), globexOrderId), {
      headers: auth(tokens.acmeOperator),
    })
    expect(acmeForeign.response.status).toBe(404)
    const globexForeign = await requestJson(replaceId(route('operatorOrder'), acmeOrderId), {
      headers: auth(tokens.globexOperator),
    })
    expect(globexForeign.response.status).toBe(404)
    expect(JSON.stringify(acmeForeign.body)).not.toContain(globexOrderId)
    expect(JSON.stringify(globexForeign.body)).not.toContain(acmeOrderId)
  })

  it('cancels through the customer command boundary and replays the durable event ID', async () => {
    const orderId = await createOrder('rest-cancel')
    const key = `rest-cancel-command-${randomUUID()}`
    const path = replaceId(route('customerCancel'), orderId)
    const options = {
      method: 'POST',
      headers: { ...auth(tokens.acmeCustomer), 'idempotency-key': key },
      body: JSON.stringify({ reason: 'customer changed plans' }),
    }

    const cancelled = await requestJson(path, options)
    expect(cancelled.response.status).toBe(200)
    expect(parseBody(cancelled.body, CustomerOrderResponseSchema).order.id).toBe(orderId)

    const replay = await requestJson(path, options)
    expect(replay.response.status).toBe(200)
    expect(parseBody(replay.body, CustomerOrderResponseSchema).order.id).toBe(orderId)

    await waitForCancellation(orderId)
    const settledReplay = await requestJson(path, options)
    expect(settledReplay.response.status).toBe(200)
    expect(parseBody(settledReplay.body, CustomerOrderResponseSchema).order.status).toBe(
      'cancelled',
    )
  })

  it('requires operator scope for the fraud decision and rejects a second decision', async () => {
    const orderId = await fraudOrder()
    const invalid = FraudDecisionSchema.safeParse({ decision: 'hold' })
    expect(invalid.success).toBe(false)

    const customerAttempt = await requestJson(replaceId(route('operatorFraudApprove'), orderId), {
      method: 'POST',
      headers: auth(tokens.acmeCustomer),
      body: '{}',
    })
    expect(customerAttempt.response.status).toBe(403)

    const approved = await requestJson(replaceId(route('operatorFraudApprove'), orderId), {
      method: 'POST',
      headers: { ...auth(tokens.acmeOperator), 'idempotency-key': `rest-approve-${randomUUID()}` },
      body: JSON.stringify({ note: 'verified by integration test' }),
    })
    expect(approved.response.status).toBe(200)

    const repeated = await requestJson(replaceId(route('operatorFraudApprove'), orderId), {
      method: 'POST',
      headers: { ...auth(tokens.acmeOperator), 'idempotency-key': `rest-repeat-${randomUUID()}` },
      body: JSON.stringify({ note: 'retry' }),
    })
    expect(repeated.response.status).toBe(409)
  })
})
