import { randomUUID } from 'node:crypto'
import {
  CreateOrderSchema,
  CustomerOrderResponseSchema,
  type OperatorOrder,
  OperatorOrderListResponseSchema,
} from '@fulfillment/contracts'
import { describe, expect, it } from 'vitest'
import { auth, integrationReady, parseBody, requestJson, route, tokens } from './support/http'
import { localstack, queueUrl, setVisibilityTimeout } from './support/localstack'

const orderInput = CreateOrderSchema.parse({
  currency: 'USD',
  lines: [{ sku: 'QUEUE-TEST', name: 'Queue test item', quantity: 1, unitPriceMinor: 4200 }],
  shippingAddress: {
    recipient: 'Queue QA',
    line1: '1 Queue Way',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  },
})
const retryInput = CreateOrderSchema.parse({
  ...orderInput,
  lines: [{ sku: 'RETRY-TWICE', name: 'Retry test item', quantity: 1, unitPriceMinor: 4200 }],
})
async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
async function createOrder(input = orderInput): Promise<string> {
  const response = await requestJson(route('customerOrders'), {
    method: 'POST',
    headers: { ...auth(tokens.acmeCustomer), 'idempotency-key': `queue-${randomUUID()}` },
    body: JSON.stringify(input),
  })
  expect([200, 201]).toContain(response.response.status)
  return parseBody(response.body, CustomerOrderResponseSchema).order.id
}
async function waitForFraudReview(orderId: string): Promise<OperatorOrder> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const listed = await requestJson(route('operatorOrders'), {
      headers: auth(tokens.acmeOperator),
    })
    expect(listed.response.status).toBe(200)
    const orders = parseBody(listed.body, OperatorOrderListResponseSchema).orders
    const order = orders.find((candidate) => candidate.id === orderId)
    if (order?.status === 'fraud_review') return order
    if (order?.status === 'failed' || order?.status === 'cancelled') {
      throw new Error(`Queue test order ${orderId} reached ${order.status}`)
    }
    await delay(250)
  }
  throw new Error(`Queue test order ${orderId} did not reach fraud review`)
}
describe.skipIf(!integrationReady)('LocalStack fulfillment topology', () => {
  it('provisions topics, filtered queues, DLQs, and Lambda mappings', async () => {
    const topics = await localstack(['sns', 'list-topics'])
    const queues = await localstack(['sqs', 'list-queues'])
    const mappings = await localstack(['lambda', 'list-event-source-mappings'])
    for (const service of ['payment', 'inventory', 'shipping']) {
      expect(topics).toContain(`fulfillment-${service}`)
      expect(queues).toContain(`fulfillment-${service}-work`)
      expect(queues).toContain(`fulfillment-${service}-dlq`)
      expect(mappings).toContain(`fulfillment-${service}-worker`)
      expect(mappings).toContain(`fulfillment-${service}-work`)
    }
    const attributes = await localstack([
      'sqs',
      'get-queue-attributes',
      '--queue-url',
      await queueUrl('fulfillment-payment-work'),
      '--attribute-names',
      'VisibilityTimeout',
      'RedrivePolicy',
    ])
    expect(attributes).toContain('120')
    expect(attributes).toContain('maxReceiveCount')
    expect(attributes).toContain('5')
  })

  it('redrives a permanent inventory partner outage into the inventory DLQ', async () => {
    const workUrl = await queueUrl('fulfillment-inventory-work')
    const deadLetterUrl = await queueUrl('fulfillment-inventory-dlq')
    const originalRedrive = await localstack([
      'sqs',
      'get-queue-attributes',
      '--queue-url',
      workUrl,
      '--attribute-names',
      'RedrivePolicy',
      '--query',
      'Attributes.RedrivePolicy',
      '--output',
      'text',
    ])
    expect(originalRedrive).toMatch(/"maxReceiveCount"\s*:\s*"?5"?/)
    try {
      await setVisibilityTimeout(workUrl, 1)
      const orderId = await createOrder(
        CreateOrderSchema.parse({
          ...orderInput,
          lines: [
            {
              sku: 'DEAD-LETTER',
              name: 'Permanent failure item',
              quantity: 1,
              unitPriceMinor: 4200,
            },
          ],
        }),
      )
      const deadline = Date.now() + 45_000
      let found = false
      while (Date.now() < deadline) {
        const received = await localstack([
          'sqs',
          'receive-message',
          '--queue-url',
          deadLetterUrl,
          '--wait-time-seconds',
          '2',
          '--max-number-of-messages',
          '10',
        ])
        if (received.includes(orderId) && received.includes('inventory.reservation.requested')) {
          found = true
          break
        }
        await delay(250)
      }
      expect(found).toBe(true)
    } finally {
      await localstack([
        'sqs',
        'set-queue-attributes',
        '--queue-url',
        workUrl,
        '--attributes',
        JSON.stringify({ VisibilityTimeout: '120', RedrivePolicy: originalRedrive }),
      ])
    }
  })

  it('retries transient inventory work and eventually reaches the fraud wait', async () => {
    const inventoryUrl = await queueUrl('fulfillment-inventory-work')
    try {
      await setVisibilityTimeout(inventoryUrl, 1)
      const order = await waitForFraudReview(await createOrder(retryInput))
      expect(order.partnerState.paymentAuthorization.state).toBe('authorized')
      expect(order.partnerState.inventoryReservation.state).toBe('reserved')
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
  })
})
