import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  combineHTTP,
  createBearerScopeProvider,
  createMemoryWebhookStore,
  createWebhookSubscriptions,
  validateWebhookEndpoint,
  type WebhookEndpointPolicyContext,
} from '../src'
import { verifySignature } from '../src/signature'

const events = {
  'order.completed.v1': z.object({ orderId: z.string(), total: z.number().int().nonnegative() }),
  'order.failed.v1': z.object({ orderId: z.string(), reason: z.string() }),
}
const scopes = ['orders:webhooks:read', 'orders:webhooks:write']
const auth = createBearerScopeProvider<{ readonly account: string }>({
  verify: (token) =>
    token === 'acme' || token === 'globex'
      ? { tenantId: token, principal: { account: token }, scopes }
      : token === 'reader'
        ? { tenantId: 'acme', principal: { account: 'acme' }, scopes: ['orders:webhooks:read'] }
        : null,
})
const secretOne = `whsec_${btoa('first signing secret with enough entropy')}`
const secretTwo = `whsec_${btoa('second signing secret with enough entropy')}`
const start = Date.parse('2026-08-19T12:00:00.000Z')

function setup(
  fetcher: typeof fetch = vi.fn(async () => new Response(null, { status: 204 })),
  validate?: (context: WebhookEndpointPolicyContext) => boolean,
) {
  const store = createMemoryWebhookStore()
  let time = start
  let ids = 0
  let secrets = 0
  const subscriptions = createWebhookSubscriptions({
    id: 'orders',
    events,
    store,
    auth,
    delivery: {
      fetch: fetcher,
      backoff: [1_000, 5_000],
      maxAttempts: 3,
      timeoutMs: 1_000,
      leaseMs: 2_000,
    },
    ...(validate === undefined ? {} : { endpointPolicy: { validate } }),
    identifiers: {
      subscription: () => `sub-${++ids}`,
      delivery: () => `delivery-${++ids}`,
      secret: () => (secrets++ === 0 ? secretOne : secretTwo),
    },
    clock: () => new Date(time),
  })
  const http = combineHTTP([subscriptions])
  const call = (path: string, token: string, method = 'GET', body?: unknown) =>
    http.fetch(
      new Request(`https://api.test/subscriptions/orders${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const subscribe = (
    body: unknown = {
      endpoint: 'https://hooks.example.test/orders',
      events: ['order.completed.v1'],
    },
  ) => call('', 'acme', 'POST', body)
  return { store, subscriptions, call, subscribe, advance: (ms: number) => (time += ms) }
}

describe('outbound subscription API', () => {
  it('rejects local names, private addresses and documentation ranges as endpoints', () => {
    expect(() => validateWebhookEndpoint('https://localhost./callback')).toThrow(/public network/)
    expect(() => validateWebhookEndpoint('https://127.0.0.1/callback')).toThrow(/public network/)
    expect(() => validateWebhookEndpoint('https://[2001:db8::1]/callback')).toThrow(
      /public network/,
    )
    expect(validateWebhookEndpoint('https://hooks.example.test/callback').href).toBe(
      'https://hooks.example.test/callback',
    )
  })

  it('needs a lease that outlives the request timeout', () => {
    expect(() =>
      createWebhookSubscriptions({
        id: 'orders',
        events,
        store: createMemoryWebhookStore(),
        auth,
        delivery: { timeoutMs: 10_000, leaseMs: 10_000 },
      }),
    ).toThrow('delivery.leaseMs must be greater than delivery.timeoutMs')
  })

  it('authenticates writes, blocks unsafe endpoints, and shows the secret only once', async () => {
    const { call, subscribe } = setup()
    expect((await call('', 'nobody', 'POST', {})).status).toBe(401)
    expect((await call('', 'reader', 'POST', {})).status).toBe(403)
    const unsafe = await subscribe({
      endpoint: 'https://169.254.169.254/meta',
      events: ['order.completed.v1'],
    })
    expect(unsafe.status).toBe(400)
    expect(await unsafe.json()).toMatchObject({ code: 'WEBHOOK_INVALID_ENDPOINT' })

    const created = await subscribe()
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({
      ok: true,
      data: {
        id: 'sub-1',
        tenantId: 'acme',
        endpoint: 'https://hooks.example.test/orders',
        events: ['order.completed.v1'],
        status: 'active',
        createdAt: start,
        updatedAt: start,
        secret: secretOne,
      },
    })
    const listed = await (await call('', 'acme')).text()
    expect(listed).not.toContain(secretOne)
    expect(JSON.parse(listed)).toMatchObject({ ok: true, data: [{ id: 'sub-1' }] })
    expect((await call('/sub-1', 'globex')).status).toBe(404)
  })

  it('updates, pauses, rotates and deletes a subscription', async () => {
    const { call, store, subscribe } = setup()
    await subscribe()
    const paused = await call('/sub-1', 'acme', 'PATCH', {
      endpoint: 'https://new.example.test/callback',
      events: ['order.completed.v1', 'order.failed.v1'],
      status: 'paused',
    })
    expect(await paused.json()).toMatchObject({
      data: {
        endpoint: 'https://new.example.test/callback',
        events: ['order.completed.v1', 'order.failed.v1'],
        status: 'paused',
      },
    })
    expect(await (await call('/sub-1/secret', 'acme', 'POST')).json()).toMatchObject({
      data: { id: 'sub-1', secret: secretTwo },
    })
    expect((await store.getSubscription('acme', 'sub-1'))?.secret).toBe(secretTwo)
    expect((await call('/sub-1', 'acme', 'DELETE')).status).toBe(204)
    expect(await store.getSubscription('acme', 'sub-1')).toBeUndefined()
  })
})

describe('outbound publication and delivery', () => {
  it('publishes only declared events with valid data, once per event id', async () => {
    const { store, subscriptions, subscribe } = setup()
    await subscribe()
    await subscribe({
      endpoint: 'https://failures.example.test/callback',
      events: ['order.failed.v1'],
    })
    expect(
      await subscriptions.publish({
        tenantId: 'acme',
        type: 'order.completed.v1',
        data: { orderId: 'o-1', total: -1 },
      }),
    ).toMatchObject({ ok: false, code: 'WEBHOOK_EVENT_INVALID' })
    const event = {
      tenantId: 'acme',
      type: 'order.completed.v1',
      eventId: 'evt-1',
      subject: 'o-1',
      data: { orderId: 'o-1', total: 4200 },
    } as const
    expect(await subscriptions.publish(event)).toEqual({
      ok: true,
      eventId: 'evt-1',
      matchedSubscriptions: 1,
      enqueuedDeliveries: 1,
      duplicateDeliveries: 0,
      deliveryIds: ['delivery-3'],
    })
    expect(await subscriptions.publish(event)).toMatchObject({
      enqueuedDeliveries: 0,
      duplicateDeliveries: 1,
    })
    const [delivery] = await store.listDeliveries({ tenantId: 'acme', subscriptionId: 'sub-1' })
    expect(JSON.parse(delivery?.body ?? '')).toEqual({
      type: 'order.completed.v1',
      timestamp: '2026-08-19T12:00:00.000Z',
      subject: 'o-1',
      data: { orderId: 'o-1', total: 4200 },
    })
  })

  it('signs the stored bytes and retries transient failures with one message id', async () => {
    const requests: Request[] = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return requests.length === 1
        ? new Response(null, { status: 503, headers: { 'retry-after': '10' } })
        : new Response(null, { status: 204 })
    })
    const { subscriptions, subscribe, advance } = setup(fetcher)
    await subscribe()
    await subscriptions.publish({
      tenantId: 'acme',
      type: 'order.completed.v1',
      eventId: 'evt-1',
      data: { orderId: 'o-1', total: 4200 },
    })
    expect(await subscriptions.work()).toEqual({
      claimed: 1,
      outcomes: [
        {
          deliveryId: 'delivery-2',
          subscriptionId: 'sub-1',
          status: 'retrying',
          attemptCount: 1,
          nextAttemptAt: start + 10_000,
          error: 'endpoint returned HTTP 503',
          responseStatus: 503,
        },
      ],
    })
    const [first] = requests
    if (first === undefined) throw new Error('no delivery request')
    const body = await first.text()
    expect(first.headers.get('webhook-id')).toBe('evt-1')
    expect(await verifySignature(first.headers, body, [secretOne], 300, start)).toEqual({
      ok: true,
      id: 'evt-1',
      timestamp: new Date(start),
    })
    advance(9_999)
    expect(await subscriptions.work()).toEqual({ claimed: 0, outcomes: [] })
    advance(1)
    expect(await subscriptions.work()).toMatchObject({
      outcomes: [{ status: 'succeeded', attemptCount: 2, responseStatus: 204 }],
    })
    expect(requests[1]?.headers.get('webhook-id')).toBe('evt-1')
    expect(await requests[1]?.text()).toBe(body)
  })

  it('defers paused subscriptions and disables one whose endpoint answers 410', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 410 }))
    const { call, store, subscriptions, subscribe, advance } = setup(fetcher)
    await subscribe()
    await subscriptions.publish({
      tenantId: 'acme',
      type: 'order.completed.v1',
      data: { orderId: 'o-1', total: 1 },
    })
    await store.updateSubscription('acme', 'sub-1', { status: 'paused', updatedAt: start })
    expect(await subscriptions.work()).toMatchObject({
      outcomes: [{ status: 'deferred', attemptCount: 0 }],
    })
    expect(fetcher).not.toHaveBeenCalled()
    await store.updateSubscription('acme', 'sub-1', { status: 'active', updatedAt: start })
    advance(60_000)
    expect(await subscriptions.work()).toMatchObject({
      outcomes: [{ status: 'failed', responseStatus: 410 }],
    })
    expect(await store.getSubscription('acme', 'sub-1')).toMatchObject({
      status: 'disabled',
      disabledReason: 'endpoint returned HTTP 410 Gone',
    })
    const log = await (await call('/sub-1/deliveries', 'acme')).json()
    expect(log.data[0]).toMatchObject({ id: 'delivery-2', status: 'failed' })
    expect(log.data[0]).not.toHaveProperty('secret')
    const retried = await call('/sub-1/deliveries/delivery-2/retry', 'acme', 'POST')
    expect(retried.status).toBe(202)
    expect(await retried.json()).toMatchObject({
      data: { id: 'delivery-2', status: 'queued', attemptCount: 0 },
    })
  })

  it('rechecks the endpoint policy right before network access', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    const { store, subscriptions, subscribe } = setup(fetcher, ({ phase }) => phase !== 'deliver')
    await subscribe()
    await subscriptions.publish({
      tenantId: 'acme',
      type: 'order.completed.v1',
      data: { orderId: 'o-1', total: 1 },
    })
    expect(await subscriptions.work()).toMatchObject({
      outcomes: [
        {
          status: 'failed',
          error:
            'endpoint rejected before delivery: webhook endpoint was rejected by the endpoint policy',
        },
      ],
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await store.getSubscription('acme', 'sub-1')).toMatchObject({ status: 'disabled' })
  })

  it('reclaims a delivery whose worker lease expired', async () => {
    const { store, subscriptions, subscribe, advance } = setup()
    await subscribe()
    await subscriptions.publish({
      tenantId: 'acme',
      type: 'order.completed.v1',
      data: { orderId: 'o-1', total: 1 },
    })
    expect(
      await store.claimDeliveries({
        now: start,
        limit: 1,
        leaseId: 'crashed',
        leaseExpiresAt: start + 2_000,
      }),
    ).toHaveLength(1)
    expect(await subscriptions.work()).toEqual({ claimed: 0, outcomes: [] })
    advance(2_000)
    expect(await subscriptions.work()).toMatchObject({
      claimed: 1,
      outcomes: [{ status: 'succeeded' }],
    })
  })
})
