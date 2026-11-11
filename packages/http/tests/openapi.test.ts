import { defineWizard } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  combineHTTP,
  createHTTP,
  createMemoryWebhookStore,
  createWebhookSubscriptions,
} from '../src'
import { auth, memoryRuns, orders } from './fixtures/orders'

const invoices = defineWizard(
  {
    name: 'invoices',
    context: z.object({ invoiceId: z.string() }),
    events: { paid: z.object({ amount: z.number() }) },
  },
  ({ step, steps }) =>
    steps({
      wait: step({ waitFor: { paid: () => undefined } }),
    }),
)

function shop() {
  return combineHTTP([
    createHTTP(orders, {
      runs: memoryRuns(),
      auth,
      access: {
        context: ['orderId'],
        flow: ['create', 'read', 'cancel'],
        steps: { review: ['read', 'setInput'] },
        events: ['payment.captured'],
      },
      receive: {
        events: ['payment.captured'],
        secret: `whsec_${btoa('receiver secret')}`,
        resolve: () => undefined,
      },
    }),
    createHTTP(invoices, {
      runs: { get: () => undefined },
      auth,
      access: { flow: ['read', 'cancel'] },
    }),
    createWebhookSubscriptions({
      id: 'orders',
      events: { 'order.shipped': z.object({ orderId: z.string(), trackingId: z.string() }) },
      store: createMemoryWebhookStore(),
      auth,
    }),
  ])
}

describe('OpenAPI document', () => {
  const document = shop().openAPI({ title: 'Shop', version: '1.0.0' })
  const operations = Object.values(document.paths).flatMap((methods) => Object.values(methods))

  it('names every operation uniquely, tags it, and describes it', () => {
    expect(operations.map((operation) => operation.operationId)).toEqual([
      'ordersCreateRun',
      'ordersGetRun',
      'ordersStreamRun',
      'ordersGetStep',
      'ordersDispatchCommand',
      'ordersSendPaymentCaptured',
      'ordersReceivePaymentCaptured',
      'invoicesGetRun',
      'invoicesStreamRun',
      'invoicesDispatchCommand',
      'ordersListSubscriptions',
      'ordersCreateSubscription',
      'ordersGetSubscription',
      'ordersUpdateSubscription',
      'ordersDeleteSubscription',
      'ordersRotateSecret',
      'ordersListDeliveries',
      'ordersRetryDelivery',
    ])
    expect(document.tags.map((tag) => tag.name)).toEqual([
      'orders',
      'orders.webhooks',
      'invoices',
      'orders.subscriptions',
    ])
    for (const operation of operations) {
      expect(operation.description.length).toBeGreaterThan(0)
      expect(document.tags.map((tag) => tag.name)).toContain(operation.tags[0])
    }
  })

  it('keeps the Mirror wire POST out of the document', () => {
    expect(Object.keys(document.paths['/api/orders/{runId}/stream'] ?? {})).toEqual(['get'])
    expect(document.components.schemas.OrdersRunFrame).toMatchObject({
      discriminator: { propertyName: 'kind' },
      oneOf: [
        { properties: { kind: { const: 'snapshot' } } },
        {
          properties: {
            kind: { const: 'progress' },
            event: { required: ['type', 'step', 'value', 'seq', 'at', 'path'] },
          },
        },
      ],
    })
  })

  it("names component schemas after the wizard's schemas", () => {
    expect(document.components.schemas.OrdersInput).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string' }, secret: { type: 'string' } },
      required: ['orderId', 'secret'],
      description: 'The context that creates a run of orders.',
    })
    expect(document.components.schemas.OrdersRunContext).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
      additionalProperties: false,
    })
    expect(document.components.schemas.OrdersPaymentCapturedPayload).toMatchObject({
      type: 'object',
      properties: { amount: { type: 'integer' } },
    })
    expect(document.components.schemas.OrdersCommand).toEqual({
      description: 'A command for a run of orders, selected by `type`.',
      oneOf: [
        { $ref: '#/components/schemas/OrdersCancelCommand' },
        { $ref: '#/components/schemas/OrdersSetInputCommand' },
      ],
      discriminator: {
        propertyName: 'type',
        mapping: {
          cancel: '#/components/schemas/OrdersCancelCommand',
          setInput: '#/components/schemas/OrdersSetInputCommand',
        },
      },
    })
    expect(document.components.schemas.RunStatus?.enum).toEqual([
      'idle',
      'running',
      'waiting',
      'halted',
      'done',
      'failed',
      'compensating',
      'cancelled',
    ])
  })

  it('documents each public outbound event as an OpenAPI webhook', () => {
    expect(Object.keys(document.webhooks ?? {})).toEqual(['orders.order.shipped'])
    expect(document.components.schemas.OrdersOrderShippedData).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string' }, trackingId: { type: 'string' } },
      required: ['orderId', 'trackingId'],
      additionalProperties: false,
    })
  })

  it('refuses two sources that claim the same route', () => {
    const http = createHTTP(invoices, {
      runs: { get: () => undefined },
      auth,
      access: { flow: ['read'] },
    })
    expect(() => combineHTTP([http, http])).toThrow("duplicate HTTP resource id 'invoices:getRun'")
  })
})
