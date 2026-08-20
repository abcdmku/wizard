import { createRun, defineFlow, type FlowRun } from '@openwizard/core'
import { Webhook } from 'standardwebhooks'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineWebhook, defineWebhooks, type WebhookIdempotencyStore } from '../src'

const secret = `whsec_${Buffer.from('a test signing secret with enough entropy').toString('base64')}`

const shipment = defineFlow({
  name: 'shipment-webhook-test',
  context: z.object({ orderId: z.string(), shipmentId: z.string().optional() }),
  events: {
    'shipment.ready': z.object({ orderId: z.string(), shipmentId: z.string() }),
  },
  correlate: { 'shipment.ready': (payload) => payload.orderId },
})

const shipmentFlow = shipment.steps({
  waiting: shipment.wait({
    on: {
      'shipment.ready': ({ payload, update }) => update({ shipmentId: payload.shipmentId }),
    },
    next: 'done',
  }),
  done: shipment.final({ output: ({ context }) => context.shipmentId }),
})

function createShipmentRun(): FlowRun<typeof shipmentFlow> {
  return createRun(shipmentFlow, {
    context: { orderId: 'order-1' },
    correlationId: 'order-1',
  })
}

function signedRequest(
  body: unknown,
  options: { readonly id?: string; readonly signature?: string } = {},
): Request {
  const raw = JSON.stringify(body)
  const date = new Date()
  const id = options.id ?? 'msg-1'
  const signature = options.signature ?? new Webhook(secret).sign(id, date, raw)
  return new Request('https://example.test/webhooks/shipment.ready', {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
      'webhook-signature': signature,
    },
  })
}

function envelope(data: unknown, overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    type: 'shipment.ready',
    timestamp: new Date().toISOString(),
    subject: 'order-1',
    data,
    ...overrides,
  }
}

describe('defineWebhook', () => {
  it('verifies the raw request and sends data through the flow event boundary', async () => {
    const run = createShipmentRun()
    await run.start()
    const resource = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      resolveRun: () => run,
    })

    const response = await resource.handle(
      signedRequest(envelope({ orderId: 'order-1', shipmentId: 'shipment-9' })),
    )

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'accepted',
      webhookId: 'msg-1',
      event: 'shipment.ready',
    })
    expect(run.getState().context).toMatchObject({ shipmentId: 'shipment-9' })
    expect(run.result()).toMatchObject({ status: 'done', output: 'shipment-9' })
  })

  it('rejects bad signatures before resolving a run', async () => {
    const resolveRun = vi.fn(() => createShipmentRun())
    const resource = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      resolveRun,
    })

    const response = await resource.handle(
      signedRequest(envelope({ orderId: 'order-1', shipmentId: 'shipment-9' }), {
        signature: 'v1,not-a-signature',
      }),
    )

    expect(response.status).toBe(401)
    expect(resolveRun).not.toHaveBeenCalled()
  })

  it('returns a boundary rejection as 422 and releases its idempotency claim', async () => {
    const run = createShipmentRun()
    await run.start()
    const claimed = new Set<string>()
    const store: WebhookIdempotencyStore = {
      claim: (id) => !claimed.has(id) && Boolean(claimed.add(id)),
      release: (id) => {
        claimed.delete(id)
      },
    }
    const resource = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      idempotency: store,
      resolveRun: () => run,
    })

    const response = await resource.handle(
      signedRequest(envelope({ orderId: 'order-1', shipmentId: 9 })),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'BOUNDARY_REJECTED',
    })
    expect(claimed.size).toBe(0)
  })

  it('acknowledges a duplicate message id without resolving or sending it again', async () => {
    const resolveRun = vi.fn(() => createShipmentRun())
    const store: WebhookIdempotencyStore = {
      claim: () => false,
      release: vi.fn(),
    }
    const resource = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      idempotency: store,
      resolveRun,
    })

    const response = await resource.handle(
      signedRequest(envelope({ orderId: 'order-1', shipmentId: 'shipment-9' })),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'duplicate' })
    expect(resolveRun).not.toHaveBeenCalled()
  })

  it('rejects another signed event type and a missing run', async () => {
    const resource = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      resolveRun: () => undefined,
    })

    const mismatch = await resource.handle(
      signedRequest(
        envelope({ orderId: 'order-1', shipmentId: 'shipment-9' }, { type: 'shipment.cancelled' }),
      ),
    )
    expect(mismatch.status).toBe(400)

    const missing = await resource.handle(
      signedRequest(envelope({ orderId: 'order-1', shipmentId: 'shipment-9' }), { id: 'msg-2' }),
    )
    expect(missing.status).toBe(404)
  })

  it('generates the route and OpenAPI operation from the event declaration', () => {
    const resource = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      resolveRun: () => undefined,
      documentation: {
        dataSchema: {
          type: 'object',
          required: ['orderId', 'shipmentId'],
          properties: {
            orderId: { type: 'string' },
            shipmentId: { type: 'string' },
          },
        },
      },
    })

    expect(resource.path).toBe('/webhooks/shipment.ready')
    expect(resource.openAPI).toMatchObject({
      summary: 'Receive shipment.ready',
      operationId: 'receiveShipmentReadyWebhook',
      'x-standard-webhooks': '1.0.0',
    })
    expect(resource.openAPI.parameters).toHaveLength(3)
    expect(resource.openAPI.responses).toHaveProperty('202')
  })
})

describe('defineWebhooks', () => {
  it('rejects duplicate ids and routes', () => {
    const first = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      secret,
      resolveRun: () => undefined,
    })
    const duplicateId = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      id: first.id,
      path: '/hooks/second',
      secret,
      resolveRun: () => undefined,
    })
    const duplicateRoute = defineWebhook({
      flow: shipmentFlow,
      event: 'shipment.ready',
      id: 'second',
      path: first.path,
      secret,
      resolveRun: () => undefined,
    })

    expect(() => defineWebhooks([first, duplicateId])).toThrow(/duplicate webhook resource id/)
    expect(() => defineWebhooks([first, duplicateRoute])).toThrow(/duplicate webhook route/)
  })
})
