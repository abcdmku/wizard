import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  CreateOrderSchema,
  CustomerOrderResponseSchema,
  fulfillmentRoutes,
  type OperatorOrder,
  OperatorOrderListResponseSchema,
  OperatorOrderResponseSchema,
  PartnerCallbackSchema,
} from '@fulfillment/contracts'
import { describe, expect, it } from 'vitest'
import { shipmentSucceeded } from './support/fulfillment'
import { auth, integrationReady, parseBody, requestJson, route, tokens } from './support/http'
import { localstack } from './support/localstack'
import { rawCallback, signedHeaders } from './support/webhook'

const execFileAsync = promisify(execFile)
const systemRoot = fileURLToPath(new URL('..', import.meta.url))
const input = CreateOrderSchema.parse({
  currency: 'USD',
  lines: [{ sku: 'RESTART-TEST', name: 'Restart test item', quantity: 1, unitPriceMinor: 4200 }],
  shippingAddress: {
    recipient: 'Restart QA',
    line1: '1 Recovery Way',
    city: 'Austin',
    region: 'TX',
    postalCode: '99999',
    country: 'US',
  },
})
const retryInput = CreateOrderSchema.parse({
  ...input,
  lines: [{ sku: 'RETRY-TWICE', name: 'Retry during restart', quantity: 1, unitPriceMinor: 4200 }],
})

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

interface CreatedOrder {
  readonly id: string
  readonly key: string
}

async function createOrder(orderInput = input): Promise<CreatedOrder> {
  const key = `restart-${randomUUID()}`
  const response = await requestJson(route('customerOrders'), {
    method: 'POST',
    headers: { ...auth(tokens.acmeCustomer), 'idempotency-key': key },
    body: JSON.stringify(orderInput),
  })
  expect([200, 201]).toContain(response.response.status)
  return { id: parseBody(response.body, CustomerOrderResponseSchema).order.id, key }
}

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

async function waitForStatus(
  orderId: string,
  status: OperatorOrder['status'],
): Promise<OperatorOrder> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const listed = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.acmeOperator),
    })
    expect(listed.response.status).toBe(200)
    const orders = parseBody(listed.body, OperatorOrderListResponseSchema).orders
    const order = orders.find((candidate) => candidate.id === orderId)
    if (order?.status === status) return order
    if (order?.status === 'failed' || order?.status === 'cancelled') {
      throw new Error(`Restart test order ${orderId} reached ${order.status}`)
    }
    await delay(300)
  }
  throw new Error(`Restart test order ${orderId} did not reach ${status}`)
}

async function waitForActiveStep(orderId: string, stepId: string): Promise<OperatorOrder> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const listed = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.acmeOperator),
    })
    expect(listed.response.status).toBe(200)
    const orders = parseBody(listed.body, OperatorOrderListResponseSchema).orders
    const order = orders.find((candidate) => candidate.id === orderId)
    if (order?.workflow.steps.some((step) => step.id === stepId && step.status === 'active')) {
      return order
    }
    if (order?.status === 'failed' || order?.status === 'cancelled') {
      throw new Error(`Restart test order ${orderId} reached ${order.status}`)
    }
    await delay(300)
  }
  throw new Error(`Restart test order ${orderId} did not activate ${stepId}`)
}

async function restartOrchestrator(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'orchestrator'], { cwd: systemRoot })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const health = await requestJson(route('health'))
      if (health.response.status === 200) return
    } catch {
      // The restart window can refuse connections before the health check returns.
    }
    await delay(500)
  }
  throw new Error('Orchestrator did not become healthy after restart')
}

describe.skipIf(!integrationReady)('Compose restart recovery', () => {
  it('restores a fraud wait, keeps the projection, and resumes after approval', async () => {
    const created = await createOrder()
    const orderId = created.id
    const waiting = await waitForActiveStep(orderId, 'waitFraudReview')
    expect(waiting.status).toBe('fraud_review')
    const approvalKey = `restart-approve-${randomUUID()}`
    const approvalBody = JSON.stringify({ note: 'approved before durable restart replay' })
    const approved = await requestJson(replaceOrder(route('operatorFraudApprove'), orderId), {
      method: 'POST',
      headers: { ...auth(tokens.acmeOperator), 'idempotency-key': approvalKey },
      body: approvalBody,
    })
    expect(approved.response.status).toBe(200)
    const shipping = await waitForActiveStep(orderId, 'waitShipment')
    expect(shipping.status).toBe('shipping')

    await restartOrchestrator()

    const afterRestart = await requestJson(replaceOrder(route('operatorOrder'), orderId), {
      headers: auth(tokens.acmeOperator),
    })
    expect(afterRestart.response.status).toBe(200)
    const versionBeforeReplay = parseBody(afterRestart.body, OperatorOrderResponseSchema).order
      .workflow.seq
    const auditBeforeReplay = await sql(
      `SELECT count(*) FROM fulfillment_callback_audit WHERE order_id = '${orderId}'`,
    )

    const replay = await requestJson(replaceOrder(route('operatorFraudApprove'), orderId), {
      method: 'POST',
      headers: { ...auth(tokens.acmeOperator), 'idempotency-key': approvalKey },
      body: approvalBody,
    })
    expect(replay.response.status).toBe(200)
    expect(parseBody(replay.body, OperatorOrderResponseSchema).order.id).toBe(orderId)

    const afterReplay = await requestJson(replaceOrder(route('operatorOrder'), orderId), {
      headers: auth(tokens.acmeOperator),
    })
    expect(afterReplay.response.status).toBe(200)
    expect(parseBody(afterReplay.body, OperatorOrderResponseSchema).order.workflow.seq).toBe(
      versionBeforeReplay,
    )
    const auditAfterReplay = await sql(
      `SELECT count(*) FROM fulfillment_callback_audit WHERE order_id = '${orderId}'`,
    )
    expect(auditAfterReplay).toBe(auditBeforeReplay)

    const callback = PartnerCallbackSchema.parse({
      ...shipmentSucceeded(),
      eventId: `evt-restart-shipment-${orderId}`,
      orderId,
      tenantId: 'tenant-acme',
    })
    const callbackBody = rawCallback(callback)
    const callbackResponse = await requestJson(fulfillmentRoutes.partnerWebhook, {
      method: 'POST',
      headers: signedHeaders(callbackBody, 'shipping'),
      body: callbackBody,
    })
    expect(callbackResponse.response.status).toBe(202)
    const shipped = await waitForStatus(orderId, 'shipped')
    expect(shipped.partnerState.paymentCapture.state).toBe('captured')
  })

  it('recovers queued Lambda work after an API restart', async () => {
    const inventoryUrl = await localstack([
      'sqs',
      'get-queue-url',
      '--queue-name',
      'fulfillment-inventory-work',
      '--query',
      'QueueUrl',
      '--output',
      'text',
    ])
    try {
      // Keep this restart drill repeatable after an interrupted local run leaves an invisible item.
      await localstack(['sqs', 'purge-queue', '--queue-url', inventoryUrl])
      await localstack([
        'sqs',
        'set-queue-attributes',
        '--queue-url',
        inventoryUrl,
        '--attributes',
        JSON.stringify({ VisibilityTimeout: '1' }),
      ])
      const created = await createOrder(retryInput)
      await restartOrchestrator()
      const recovered = await waitForStatus(created.id, 'fraud_review')
      expect(recovered.partnerState.paymentAuthorization.state).toBe('authorized')
      expect(recovered.partnerState.inventoryReservation.state).toBe('reserved')
    } finally {
      await localstack([
        'sqs',
        'set-queue-attributes',
        '--queue-url',
        inventoryUrl,
        '--attributes',
        JSON.stringify({ VisibilityTimeout: '120' }),
      ])
    }
  }, 90_000)
})

function replaceOrder(path: string, orderId: string): string {
  return path.replace(':id', encodeURIComponent(orderId))
}
