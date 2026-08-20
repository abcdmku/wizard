import { createRun, defineFlow, type FlowRun } from '@openwizard/core'
import { Webhook } from 'standardwebhooks'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createBearerScopeProvider, createHTTP } from '../src'
import { planAccess } from '../src/access'

const secret = `whsec_${Buffer.from('a generated receiver signing secret').toString('base64')}`
const builder = defineFlow({
  name: 'orders',
  context: z.object({ publicId: z.string(), secret: z.string() }),
  autoRun: 'manual',
  events: {
    'shipment.ready': z.object({ shipmentId: z.string() }),
    'shipment.failed': z.object({ reason: z.string() }),
  },
})
const flow = builder.steps({
  waiting: builder.wait({
    on: {
      'shipment.ready': () => undefined,
      'shipment.failed': () => undefined,
    },
    next: 'charge',
  }),
  charge: builder.task(() => ({ captured: true }), { next: 'done' }),
  done: builder.final(),
})
const fulfilment = defineFlow({ name: 'fulfilment', context: z.object({}) })
const fulfilmentFlow = fulfilment.steps({
  pack: fulfilment.task(() => undefined, { next: 'done' }),
  done: fulfilment.final(),
})
const nestedOrders = defineFlow({ name: 'nested-orders', context: z.object({}) })
const nestedOrdersFlow = nestedOrders.steps({
  fulfilment: nestedOrders.flow(fulfilmentFlow, { context: () => ({}), next: 'done' }),
  done: nestedOrders.final(),
})
type Principal = { readonly accountId: string }
const auth = createBearerScopeProvider<Principal>({
  verify: (token) =>
    token === 'valid'
      ? {
          tenantId: 'account-1',
          principal: { accountId: 'account-1' },
          scopes: ['orders:read', 'orders:command'],
        }
      : null,
})

function orderRun(): FlowRun<typeof flow> {
  return createRun(flow, {
    context: { publicId: 'order-1', secret: 'never-expose-me' },
    instanceId: 'order-1',
  })
}

function signedRequest(event: 'shipment.ready' | 'shipment.failed', data: unknown): Request {
  const raw = JSON.stringify({
    type: event,
    timestamp: new Date().toISOString(),
    subject: 'order-1',
    data,
  })
  const date = new Date()
  const id = 'message-1'
  return new Request(`https://example.test/webhooks/${event}`, {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
      'webhook-signature': new Webhook(secret).sign(id, date, raw),
    },
  })
}

function commandRequest(runId: string, command: unknown): Request {
  return new Request(`https://example.test/api/orders/${runId}/commands`, {
    method: 'POST',
    body: JSON.stringify(command),
    headers: {
      authorization: 'Bearer valid',
      'content-type': 'application/json',
    },
  })
}

describe('createHTTP', () => {
  it('enables the complete REST API and every incoming event by default', async () => {
    const run = orderRun()
    await run.start()
    const http = createHTTP(flow, {
      api: {
        auth,
        data: { get: () => run },
      },
      receive: {
        secret,
        resolve: () => run,
      },
    })

    expect(http.resources.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /webhooks/shipment.ready',
      'POST /webhooks/shipment.failed',
      'GET /api/orders/:runId',
      'GET /api/orders/:runId/steps/:step',
      'POST /api/orders/:runId/commands',
    ])

    const receiver = http.receivers.find(({ event }) => event === 'shipment.ready')
    expect(receiver).toBeDefined()
    const response = await receiver?.handle(signedRequest('shipment.ready', { shipmentId: 's-1' }))
    expect(response?.status).toBe(202)
  })

  it('turns capability lists into reads, commands, receivers, and exact OpenAPI', async () => {
    const run = orderRun()
    const get = vi.fn(() => run)
    const http = createHTTP(flow, {
      api: {
        path: '/api/orders',
        auth,
        data: { get },
        access: {
          context: ['publicId'],
          flow: ['read', 'start'],
          steps: {
            charge: ['output', 'run', 'retry'],
          },
          events: ['shipment.ready'],
        },
      },
      receive: {
        secret,
        resolve: () => run,
        events: ['shipment.ready'],
      },
    })

    expect(http.receivers.map(({ event }) => event)).toEqual(['shipment.ready'])
    const stepRead = http.resources.find(({ path }) => path.endsWith('/steps/:step'))
    expect(stepRead?.openAPI).toMatchObject({
      parameters: [
        expect.objectContaining({ name: 'runId' }),
        expect.objectContaining({
          name: 'step',
          schema: expect.objectContaining({ enum: ['charge'] }),
        }),
      ],
    })

    const commands = http.resources.find(({ path }) => path.endsWith('/commands'))
    if (commands === undefined) throw new Error('generated command resource not found')
    const commandTypes = commandSchemas(commands.openAPI).map(
      (schema) => (schema.properties as Record<string, { readonly const?: string }>).type?.const,
    )
    expect(commandTypes).toEqual(['start', 'retry', 'run', 'send'])

    const denied = await commands.handle(
      commandRequest(run.id, {
        type: 'send',
        event: 'shipment.failed',
        payload: { reason: 'lost' },
      }),
    )
    expect(denied.status).toBe(403)

    const runRead = http.resources.find(
      ({ method, path }) => method === 'GET' && path === '/api/orders/:runId',
    )
    const read = await runRead?.handle(
      new Request(`https://example.test/api/orders/${run.id}`, {
        headers: { authorization: 'Bearer valid' },
      }),
    )
    expect(await read?.json()).toMatchObject({
      data: {
        context: { publicId: 'order-1' },
        progress: expect.any(Object),
      },
    })
    expect(get).toHaveBeenCalledWith('account-1', run.id)
  })

  it('expands flow read access to output and progress', () => {
    expect(planAccess(flow, { flow: ['read'] }).expose).toMatchObject({
      output: true,
      progress: true,
    })
  })

  it('allows command-only step access without adding a step read route', () => {
    const run = orderRun()
    const http = createHTTP(flow, {
      api: {
        auth,
        data: { get: () => run },
        access: { steps: { charge: ['run'] } },
      },
    })

    expect(http.resources.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/orders/:runId/commands',
    ])
  })

  it('limits only the first segment of a nested command path', () => {
    const run = createRun(nestedOrdersFlow, { context: {}, instanceId: 'nested-order-1' })
    const http = createHTTP(nestedOrdersFlow, {
      api: {
        auth,
        data: { get: () => run },
        access: { steps: { fulfilment: ['child'] } },
      },
    })
    const commands = http.resources.find(({ path }) => path.endsWith('/commands'))
    if (commands === undefined) throw new Error('generated command resource not found')
    const child = commandSchemas(commands.openAPI).find(
      (schema) =>
        (schema.properties as Record<string, { readonly const?: string }>).type?.const === 'child',
    )
    if (child === undefined) throw new Error('generated child command schema not found')

    expect((child.properties as Record<string, unknown>).path).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string', enum: ['fulfilment'] }],
      items: { type: 'string' },
      minItems: 1,
      maxItems: 8,
    })
  })

  it('rejects unknown or invalid runtime capabilities', () => {
    const run = orderRun()
    const base = { auth, data: { get: () => run } }
    expect(() =>
      createHTTP(flow, {
        api: { ...base, access: { steps: { missing: ['read'] } } as never },
      }),
    ).toThrow(/unknown step 'missing'/)
    expect(() =>
      createHTTP(flow, {
        api: { ...base, access: { events: ['missing'] } as never },
      }),
    ).toThrow(/unknown event 'missing'/)
    expect(() =>
      createHTTP(flow, {
        api: { ...base, access: { steps: { charge: ['setInput'] } } as never },
      }),
    ).toThrow(/does not support HTTP capability 'setInput'/)
  })
})

function commandSchemas(operation: object): readonly Readonly<Record<string, unknown>>[] {
  return (
    operation as {
      readonly requestBody: {
        readonly content: {
          readonly 'application/json': {
            readonly schema: { readonly oneOf: readonly Readonly<Record<string, unknown>>[] }
          }
        }
      }
    }
  ).requestBody.content['application/json'].schema.oneOf
}
