import { createRun, defineFlow } from '@openwizard/core'
import { Webhook } from 'standardwebhooks'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  type AnyWebhookSubscriptions,
  createBearerScopeProvider,
  createHTTP,
  createMemoryWebhookStore,
  createOAuth2ScopeProvider,
  createWebhookSubscriptions,
  defineOutboundEvents,
  validateWebhookEndpoint,
  type WebhookDelivery,
  type WebhookEndpointPolicyContext,
  type WebhookEnqueueResult,
  type WebhookStore,
  type WebhookSubscription,
} from '../src'

const outboundEvents = defineOutboundEvents({
  'order.completed.v1': z.object({ orderId: z.string(), total: z.number().int().nonnegative() }),
  'order.failed.v1': z.object({ orderId: z.string(), reason: z.string() }),
})

const runBuilder = defineFlow({
  name: 'orders',
  context: z.object({ orderId: z.string(), total: z.number() }),
})
const runFlow = runBuilder.steps({
  complete: runBuilder.task(({ context }) => ({ orderId: context.orderId, total: context.total }), {
    next: 'done',
  }),
  done: runBuilder.final({ output: ({ context }) => context.orderId }),
})
const childBuilder = defineFlow({ name: 'child', context: z.object({ orderId: z.string() }) })
const childFlow = childBuilder.steps({
  work: childBuilder.task(({ context }) => ({ orderId: context.orderId }), { next: 'done' }),
  done: childBuilder.final(),
})
const parentBuilder = defineFlow({ name: 'parent', context: z.object({ orderId: z.string() }) })
const parentFlow = parentBuilder.steps({
  child: parentBuilder.flow(childFlow, {
    context: ({ context }) => ({ orderId: context.orderId }),
    next: 'done',
  }),
  done: parentBuilder.final(),
})
const nonJsonBuilder = defineFlow({ name: 'non-json', context: z.object({}) })
const nonJsonFlow = nonJsonBuilder.steps({
  work: nonJsonBuilder.task(() => ({ value: BigInt(1) }), { next: 'done' }),
  done: nonJsonBuilder.final(),
})
const pausedBuilder = defineFlow({ name: 'paused', context: z.object({}) })
const pausedFlow = pausedBuilder.steps({
  gate: pausedBuilder.view({ next: 'done' }),
  done: pausedBuilder.final(),
})

type Principal = { readonly accountId: string }

const auth = createBearerScopeProvider<Principal>({
  verify: (token) => {
    if (token === 'account-1') {
      return {
        tenantId: 'account-1',
        principal: { accountId: 'account-1' },
        scopes: ['orders:webhooks:read', 'orders:webhooks:write'],
      }
    }
    if (token === 'account-2') {
      return {
        tenantId: 'account-2',
        principal: { accountId: 'account-2' },
        scopes: ['orders:webhooks:read', 'orders:webhooks:write'],
      }
    }
    if (token === 'read-only') {
      return {
        tenantId: 'account-1',
        principal: { accountId: 'account-1' },
        scopes: ['orders:webhooks:read'],
      }
    }
    return null
  },
})

const secretOne = webhookSecret('first signing secret with enough entropy')
const secretTwo = webhookSecret('second signing secret with enough entropy')

function webhookSecret(value: string): string {
  return `whsec_${Buffer.from(value).toString('base64')}`
}

function request(
  url: string,
  options: { readonly method?: string; readonly token?: string; readonly body?: unknown } = {},
): Request {
  return new Request(url, {
    ...(options.method === undefined ? {} : { method: options.method }),
    headers: {
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

function createFixture(
  fetcher: typeof fetch = vi.fn(async () => new Response(null, { status: 204 })),
  validateEndpoint?: (context: WebhookEndpointPolicyContext) => boolean,
) {
  const store = createMemoryWebhookStore()
  let time = Date.parse('2026-08-19T12:00:00.000Z')
  let subscriptionSequence = 0
  let eventSequence = 0
  let deliverySequence = 0
  let leaseSequence = 0
  let secretSequence = 0
  const subscriptions = createWebhookSubscriptions({
    id: 'orders',
    events: outboundEvents,
    store,
    api: {
      auth,
      path: '/api/order-webhooks',
    },
    delivery: {
      fetch: fetcher,
      backoff: [1_000, 5_000],
      maxAttempts: 3,
      timeoutMs: 1_000,
      leaseMs: 2_000,
    },
    ...(validateEndpoint === undefined ? {} : { endpointPolicy: { validate: validateEndpoint } }),
    identifiers: {
      subscription: () => `sub-${++subscriptionSequence}`,
      event: () => `event-${++eventSequence}`,
      delivery: () => `delivery-${++deliverySequence}`,
      lease: () => `lease-${++leaseSequence}`,
      secret: () => (secretSequence++ === 0 ? secretOne : secretTwo),
    },
    clock: () => new Date(time),
  })
  return {
    store,
    subscriptions,
    advance: (milliseconds: number) => {
      time += milliseconds
    },
  }
}

function resource(
  subscriptions: Pick<AnyWebhookSubscriptions, 'resources'>,
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST',
  path: string,
) {
  const found = subscriptions.resources.find(
    (candidate) => candidate.method === method && candidate.path === path,
  )
  if (found === undefined) throw new Error(`resource ${method} ${path} not found`)
  return found
}

function proxyStore(
  store: WebhookStore,
  enqueueDeliveries: (deliveries: readonly WebhookDelivery[]) => Promise<WebhookEnqueueResult>,
): WebhookStore {
  return new Proxy(store, {
    get: (target, property) => {
      if (property === 'enqueueDeliveries') return enqueueDeliveries
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function createSubscription(
  fixture: ReturnType<typeof createFixture>,
  body: unknown = {
    endpoint: 'https://hooks.example.test/orders',
    events: ['order.completed.v1'],
  },
  token = 'account-1',
): Promise<Response> {
  return resource(fixture.subscriptions, 'POST', '/api/order-webhooks').handle(
    request('https://api.example.test/api/order-webhooks', {
      method: 'POST',
      token,
      body,
    }),
  )
}

describe('outbound webhook subscription API', () => {
  it('rejects local names, trailing-dot bypasses, private IPs, and documentation addresses', () => {
    expect(() => validateWebhookEndpoint('https://localhost./callback')).toThrow(/public network/)
    expect(() => validateWebhookEndpoint('https://127.0.0.1/callback')).toThrow(/public network/)
    expect(() => validateWebhookEndpoint('https://[2001:db8::1]/callback')).toThrow(
      /public network/,
    )
    expect(validateWebhookEndpoint('https://hooks.example.test/callback').href).toBe(
      'https://hooks.example.test/callback',
    )
  })

  it('requires the claim lease to outlive the delivery request timeout', () => {
    expect(() =>
      createWebhookSubscriptions({
        id: 'unsafe-lease',
        events: outboundEvents,
        store: createMemoryWebhookStore(),
        api: { auth },
        delivery: { timeoutMs: 10_000, leaseMs: 10_000 },
      }),
    ).toThrow(/leaseMs must be greater/)
  })

  it('authenticates writes, blocks unsafe endpoints, and never lists signing secrets', async () => {
    const fixture = createFixture()
    const endpoint = resource(fixture.subscriptions, 'POST', '/api/order-webhooks')

    const unauthenticated = await endpoint.handle(
      request('https://api.example.test/api/order-webhooks', {
        method: 'POST',
        body: { endpoint: 'https://hooks.example.test', events: ['order.completed.v1'] },
      }),
    )
    expect(unauthenticated.status).toBe(401)

    const readOnly = await createSubscription(fixture, undefined, 'read-only')
    expect(readOnly.status).toBe(403)

    const privateEndpoint = await createSubscription(fixture, {
      endpoint: 'https://169.254.169.254/latest/meta-data',
      events: ['order.completed.v1'],
    })
    expect(privateEndpoint.status).toBe(400)
    await expect(privateEndpoint.json()).resolves.toMatchObject({
      code: 'WEBHOOK_INVALID_ENDPOINT',
    })

    const created = await createSubscription(fixture)
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: 'sub-1',
        tenantId: 'account-1',
        endpoint: 'https://hooks.example.test/orders',
        events: ['order.completed.v1'],
        status: 'active',
      },
      secret: secretOne,
    })

    const list = await resource(fixture.subscriptions, 'GET', '/api/order-webhooks').handle(
      request('https://api.example.test/api/order-webhooks', { token: 'account-1' }),
    )
    const listBody = await list.text()
    expect(list.status).toBe(200)
    expect(listBody).not.toContain(secretOne)
    expect(JSON.parse(listBody)).toMatchObject({ data: [{ id: 'sub-1' }] })

    const foreignRead = await resource(
      fixture.subscriptions,
      'GET',
      '/api/order-webhooks/:subscriptionId',
    ).handle(request('https://api.example.test/api/order-webhooks/sub-1', { token: 'account-2' }))
    expect(foreignRead.status).toBe(404)
  })

  it('updates, pauses, rotates, and deletes a tenant subscription', async () => {
    const fixture = createFixture()
    await createSubscription(fixture)
    const subscriptionResource = resource(
      fixture.subscriptions,
      'PATCH',
      '/api/order-webhooks/:subscriptionId',
    )
    const paused = await subscriptionResource.handle(
      request('https://api.example.test/api/order-webhooks/sub-1', {
        method: 'PATCH',
        token: 'account-1',
        body: {
          endpoint: 'https://new.example.test/callback',
          events: ['order.completed.v1', 'order.failed.v1'],
          status: 'paused',
        },
      }),
    )
    await expect(paused.json()).resolves.toMatchObject({
      data: {
        endpoint: 'https://new.example.test/callback',
        events: ['order.completed.v1', 'order.failed.v1'],
        status: 'paused',
      },
    })

    const rotated = await resource(
      fixture.subscriptions,
      'POST',
      '/api/order-webhooks/:subscriptionId/secret',
    ).handle(
      request('https://api.example.test/api/order-webhooks/sub-1/secret', {
        method: 'POST',
        token: 'account-1',
      }),
    )
    await expect(rotated.json()).resolves.toMatchObject({ secret: secretTwo })
    expect((await fixture.store.getSubscription('account-1', 'sub-1'))?.secret).toBe(secretTwo)

    const deleted = await resource(
      fixture.subscriptions,
      'DELETE',
      '/api/order-webhooks/:subscriptionId',
    ).handle(
      request('https://api.example.test/api/order-webhooks/sub-1', {
        method: 'DELETE',
        token: 'account-1',
      }),
    )
    expect(deleted.status).toBe(204)
    expect(await fixture.store.getSubscription('account-1', 'sub-1')).toBeUndefined()
  })

  it('documents all management and delivery-log routes', () => {
    const fixture = createFixture()
    expect(fixture.subscriptions.resources.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/order-webhooks',
      'POST /api/order-webhooks',
      'GET /api/order-webhooks/:subscriptionId',
      'PATCH /api/order-webhooks/:subscriptionId',
      'DELETE /api/order-webhooks/:subscriptionId',
      'POST /api/order-webhooks/:subscriptionId/secret',
      'GET /api/order-webhooks/:subscriptionId/deliveries',
      'POST /api/order-webhooks/:subscriptionId/deliveries/:deliveryId/retry',
    ])
    expect(fixture.subscriptions.resources[1]?.openAPI).toMatchObject({
      operationId: 'OrdersSubscriptionCreate',
      security: [{ bearerAuth: [] }],
      'x-required-scopes': ['orders:webhooks:write'],
    })
  })
})

describe('inherited run events', () => {
  it('inherits generated subscription scopes into OAuth documentation', () => {
    const oauth = createOAuth2ScopeProvider<Principal>({
      verify: () => ({
        tenantId: 'account-1',
        principal: { accountId: 'account-1' },
        scopes: ['orders:webhooks:read'],
      }),
      flows: {
        clientCredentials: {
          tokenUrl: 'https://identity.example.test/oauth/token',
          scopes: 'inherit',
        },
      },
    })
    const webhooks = createWebhookSubscriptions(runFlow, {
      store: createMemoryWebhookStore(),
      api: { auth: oauth },
    })

    expect(webhooks.resources[0]?.openAPIComponents).toMatchObject({
      securitySchemes: {
        oauth2: {
          flows: {
            clientCredentials: {
              scopes: {
                'orders:webhooks:read': expect.any(String),
                'orders:webhooks:write': expect.any(String),
              },
            },
          },
        },
      },
    })
  })

  it('queues selected typed run events for the attached tenant', async () => {
    const store = createMemoryWebhookStore()
    let subscriptionId = 0
    let eventId = 0
    let deliveryId = 0
    const webhooks = createWebhookSubscriptions(runFlow, {
      events: ['step.runSucceeded', 'flow.done'],
      store,
      api: { auth },
      identifiers: {
        subscription: () => `sub-${++subscriptionId}`,
        event: () => `event-${++eventId}`,
        delivery: () => `delivery-${++deliveryId}`,
        secret: () => secretOne,
      },
    })
    const create = resource(webhooks, 'POST', '/api/orders/webhooks')
    const body = {
      endpoint: 'https://hooks.example.test/orders',
      events: ['step.runSucceeded', 'flow.done'],
    }
    expect(
      await create.handle(
        request('https://api.example.test/api/orders/webhooks', {
          method: 'POST',
          token: 'account-1',
          body,
        }),
      ),
    ).toMatchObject({ status: 201 })
    expect(
      await create.handle(
        request('https://api.example.test/api/orders/webhooks', {
          method: 'POST',
          token: 'account-2',
          body: { ...body, endpoint: 'https://other.example.test/orders' },
        }),
      ),
    ).toMatchObject({ status: 201 })

    const run = createRun(runFlow, {
      context: { orderId: 'order-1', total: 4200 },
      instanceId: 'order-1',
    })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })
    await run.start()
    await run.awaitResult()
    await attachment.flush()

    const own = store.listDeliveries({ tenantId: 'account-1', subscriptionId: 'sub-1' })
    expect(own.map(({ eventType }) => eventType).sort()).toEqual(['flow.done', 'step.runSucceeded'])
    const succeeded = own.find(({ eventType }) => eventType === 'step.runSucceeded')
    const done = own.find(({ eventType }) => eventType === 'flow.done')
    expect(JSON.parse(succeeded?.body ?? '')).toMatchObject({
      type: 'step.runSucceeded',
      subject: 'order-1',
      data: {
        type: 'step.runSucceeded',
        path: [],
        step: 'complete',
        output: { orderId: 'order-1', total: 4200 },
      },
    })
    expect(JSON.parse(done?.body ?? '')).toMatchObject({
      type: 'flow.done',
      data: { output: 'order-1' },
    })
    expect(store.listDeliveries({ tenantId: 'account-2', subscriptionId: 'sub-2' })).toEqual([])

    attachment.dispose()
    attachment.dispose()
    await run.reset()
    await run.start()
    await run.awaitResult()
    await attachment.flush()
    expect(store.listDeliveries({ tenantId: 'account-1', subscriptionId: 'sub-1' })).toHaveLength(2)
  })

  it('serializes enqueueing and makes flush report a store failure', async () => {
    const base = createMemoryWebhookStore()
    let releaseFirst: (() => void) | undefined
    let enqueueCount = 0
    const order: string[] = []
    const store = proxyStore(base, async (deliveries) => {
      enqueueCount += 1
      const current = enqueueCount
      order.push(`start:${current}`)
      if (current === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      if (current === 2) throw new Error('queue unavailable')
      const result = base.enqueueDeliveries(deliveries)
      order.push(`end:${current}`)
      return result
    })
    let subscriptionId = 0
    let eventId = 0
    let deliveryId = 0
    const onError = vi.fn()
    const webhooks = createWebhookSubscriptions(runFlow, {
      events: ['step.runSucceeded', 'flow.done'],
      store,
      api: { auth },
      identifiers: {
        subscription: () => `sub-${++subscriptionId}`,
        event: () => `event-${++eventId}`,
        delivery: () => `delivery-${++deliveryId}`,
        secret: () => secretOne,
      },
      onError,
    })
    const created = await resource(webhooks, 'POST', '/api/orders/webhooks').handle(
      request('https://api.example.test/api/orders/webhooks', {
        method: 'POST',
        token: 'account-1',
        body: {
          endpoint: 'https://hooks.example.test/orders',
          events: ['step.runSucceeded', 'flow.done'],
        },
      }),
    )
    expect(created.status).toBe(201)
    const run = createRun(runFlow, {
      context: { orderId: 'order-2', total: 100 },
      instanceId: 'order-2',
    })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })
    await run.start()
    await run.awaitResult()
    const flushed = attachment.flush()
    await vi.waitFor(() => expect(order).toEqual(['start:1']))
    expect(releaseFirst).toBeTypeOf('function')
    releaseFirst?.()
    await expect(flushed).rejects.toThrow('queue unavailable')
    expect(order).toEqual(['start:1', 'end:1', 'start:2'])
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'publish', tenantId: 'account-1' }),
    )
  })

  it('captures nested run events with their path', async () => {
    const store = createMemoryWebhookStore()
    let deliveryId = 0
    const webhooks = createWebhookSubscriptions(parentFlow, {
      id: 'orders',
      events: ['step.runSucceeded'],
      store,
      api: { auth },
      identifiers: {
        subscription: () => 'sub-1',
        event: () => 'event-1',
        delivery: () => `delivery-${++deliveryId}`,
        secret: () => secretOne,
      },
    })
    await resource(webhooks, 'POST', '/api/orders/webhooks').handle(
      request('https://api.example.test/api/orders/webhooks', {
        method: 'POST',
        token: 'account-1',
        body: {
          endpoint: 'https://hooks.example.test/orders',
          events: ['step.runSucceeded'],
        },
      }),
    )
    const run = createRun(parentFlow, {
      context: { orderId: 'order-child' },
      instanceId: 'parent-1',
    })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })
    await run.start()
    await run.awaitResult()
    await attachment.flush()

    const deliveries = store.listDeliveries({
      tenantId: 'account-1',
      subscriptionId: 'sub-1',
    })
    expect(deliveries).toHaveLength(1)
    expect(JSON.parse(deliveries[0]?.body ?? '')).toMatchObject({
      type: 'step.runSucceeded',
      subject: 'parent-1',
      data: {
        path: ['child'],
        step: 'work',
        output: { orderId: 'order-child' },
      },
    })
  })

  it('reports a selected event that cannot be serialized', async () => {
    const store = createMemoryWebhookStore()
    const onError = vi.fn()
    const webhooks = createWebhookSubscriptions(nonJsonFlow, {
      events: ['step.runSucceeded'],
      store,
      api: { auth },
      onError,
    })
    const run = createRun(nonJsonFlow, { context: {}, instanceId: 'non-json-1' })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })

    await run.start()
    await run.awaitResult()
    await expect(attachment.flush()).rejects.toThrow(/BigInt/)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        operation: 'publish',
        tenantId: 'account-1',
        runId: 'non-json-1',
        eventType: 'step.runSucceeded',
      }),
    )
  })

  it('filters before publication without reporting an error', async () => {
    const store = createMemoryWebhookStore()
    const onError = vi.fn()
    const webhooks = createWebhookSubscriptions(nonJsonFlow, {
      events: ['flow.done'],
      store,
      api: { auth },
      onError,
    })
    const run = createRun(nonJsonFlow, { context: {}, instanceId: 'filtered-1' })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })

    await run.start()
    await run.awaitResult()
    await attachment.flush()
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps pending publication after dispose and ignores later events', async () => {
    const base = createMemoryWebhookStore()
    let release: (() => void) | undefined
    const enqueueStarted = vi.fn()
    const store = proxyStore(base, async (deliveries) => {
      enqueueStarted()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return base.enqueueDeliveries(deliveries)
    })
    const webhooks = createWebhookSubscriptions(pausedFlow, {
      id: 'orders',
      events: ['flow.started', 'flow.done'],
      store,
      api: { auth },
      identifiers: {
        subscription: () => 'sub-1',
        event: () => 'event-1',
        delivery: () => 'delivery-1',
        secret: () => secretOne,
      },
    })
    const created = await resource(webhooks, 'POST', '/api/orders/webhooks').handle(
      request('https://api.example.test/api/orders/webhooks', {
        method: 'POST',
        token: 'account-1',
        body: {
          endpoint: 'https://hooks.example.test/orders',
          events: ['flow.started', 'flow.done'],
        },
      }),
    )
    expect(created.status).toBe(201)
    const run = createRun(pausedFlow, { context: {}, instanceId: 'paused-1' })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })

    await run.start()
    await vi.waitFor(() => expect(enqueueStarted).toHaveBeenCalledOnce())
    attachment.dispose()
    await run.next()
    await run.awaitResult()
    const flushed = attachment.flush()
    release?.()
    await flushed

    expect(
      base
        .listDeliveries({ tenantId: 'account-1', subscriptionId: 'sub-1' })
        .map(({ eventType }) => eventType),
    ).toEqual(['flow.started'])
  })

  it('isolates matching subscription ids by tenant', async () => {
    const store = createMemoryWebhookStore()
    let eventId = 0
    let deliveryId = 0
    const webhooks = createWebhookSubscriptions(runFlow, {
      events: ['flow.done'],
      store,
      api: { auth },
      identifiers: {
        subscription: () => 'shared',
        event: () => `event-${++eventId}`,
        delivery: () => `delivery-${++deliveryId}`,
        secret: () => secretOne,
      },
    })
    const create = resource(webhooks, 'POST', '/api/orders/webhooks')
    for (const tenantId of ['account-1', 'account-2']) {
      const response = await create.handle(
        request('https://api.example.test/api/orders/webhooks', {
          method: 'POST',
          token: tenantId,
          body: {
            endpoint: `https://${tenantId}.example.test/orders`,
            events: ['flow.done'],
          },
        }),
      )
      expect(response.status).toBe(201)
    }

    const first = createRun(runFlow, {
      context: { orderId: 'order-1', total: 1 },
      instanceId: 'tenant-run-1',
    })
    const firstAttachment = webhooks.attach(first, { tenantId: 'account-1' })
    await first.start()
    await first.awaitResult()
    await firstAttachment.flush()

    expect(store.listDeliveries({ tenantId: 'account-1', subscriptionId: 'shared' })).toHaveLength(
      1,
    )
    expect(store.listDeliveries({ tenantId: 'account-2', subscriptionId: 'shared' })).toEqual([])

    const second = createRun(runFlow, {
      context: { orderId: 'order-2', total: 2 },
      instanceId: 'tenant-run-2',
    })
    const secondAttachment = webhooks.attach(second, { tenantId: 'account-2' })
    await second.start()
    await second.awaitResult()
    await secondAttachment.flush()

    expect(store.listDeliveries({ tenantId: 'account-1', subscriptionId: 'shared' })).toHaveLength(
      1,
    )
    expect(store.listDeliveries({ tenantId: 'account-2', subscriptionId: 'shared' })).toHaveLength(
      1,
    )
  })

  it('generates unique event ids when a nested run is recreated after reset', async () => {
    const store = createMemoryWebhookStore()
    let eventId = 0
    let deliveryId = 0
    const webhooks = createWebhookSubscriptions(parentFlow, {
      id: 'orders',
      events: ['step.runSucceeded'],
      store,
      api: { auth },
      identifiers: {
        subscription: () => 'sub-1',
        event: () => `event-${++eventId}`,
        delivery: () => `delivery-${++deliveryId}`,
        secret: () => secretOne,
      },
    })
    await resource(webhooks, 'POST', '/api/orders/webhooks').handle(
      request('https://api.example.test/api/orders/webhooks', {
        method: 'POST',
        token: 'account-1',
        body: {
          endpoint: 'https://hooks.example.test/orders',
          events: ['step.runSucceeded'],
        },
      }),
    )
    const run = createRun(parentFlow, {
      context: { orderId: 'order-child' },
      instanceId: 'parent-reset',
    })
    const attachment = webhooks.attach(run, { tenantId: 'account-1' })

    for (let iteration = 0; iteration < 2; iteration += 1) {
      if (iteration > 0) await run.reset()
      await run.start()
      await run.awaitResult()
      await attachment.flush()
    }

    const deliveries = store.listDeliveries({
      tenantId: 'account-1',
      subscriptionId: 'sub-1',
    })
    expect(deliveries).toHaveLength(2)
    expect(new Set(deliveries.map(({ messageId }) => messageId))).toEqual(
      new Set(['event-1', 'event-2']),
    )
  })

  it('rejects unknown selection and a run created from another flow object', () => {
    const store = createMemoryWebhookStore()
    expect(() =>
      createWebhookSubscriptions(runFlow, {
        events: ['unknown.event' as never],
        store,
        api: { auth },
      }),
    ).toThrow(/unknown run event/)

    const equivalentBuilder = defineFlow({
      name: 'orders',
      context: z.object({ orderId: z.string(), total: z.number() }),
    })
    const equivalent = equivalentBuilder.steps({ done: equivalentBuilder.final() })
    const wrongRun = createRun(equivalent, {
      context: { orderId: 'order-1', total: 1 },
    })
    const webhooks = createWebhookSubscriptions(runFlow, {
      events: ['flow.done'],
      store,
      api: { auth },
    })
    expect(() => webhooks.attach(wrongRun as never, { tenantId: 'account-1' })).toThrow(
      /does not match/,
    )
  })
})

describe('outbound publication and delivery', () => {
  it('enqueues a fan-out atomically when a generated delivery id collides', () => {
    const store = createMemoryWebhookStore()
    const base: WebhookDelivery = {
      id: 'collision',
      messageId: 'event-1',
      tenantId: 'account-1',
      subscriptionId: 'sub-1',
      eventType: 'order.completed.v1',
      endpoint: 'https://hooks.example.test/one',
      body: '{}',
      secret: secretOne,
      status: 'queued',
      attemptCount: 0,
      nextAttemptAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(() =>
      store.enqueueDeliveries([
        base,
        {
          ...base,
          subscriptionId: 'sub-2',
          endpoint: 'https://hooks.example.test/two',
        },
      ]),
    ).toThrow(/already exists/)
    expect(store.listDeliveries({ tenantId: 'account-1', subscriptionId: 'sub-1' })).toEqual([])
    expect(store.listDeliveries({ tenantId: 'account-1', subscriptionId: 'sub-2' })).toEqual([])
  })

  it('validates public event data and idempotently fans out to matching subscriptions', async () => {
    const fixture = createFixture()
    await createSubscription(fixture)
    await createSubscription(fixture, {
      endpoint: 'https://failures.example.test/callback',
      events: ['order.failed.v1'],
    })

    const invalid = await fixture.subscriptions.publish({
      tenantId: 'account-1',
      type: 'order.completed.v1',
      data: { orderId: 'order-1', total: -1 },
    })
    expect(invalid).toMatchObject({ ok: false, code: 'WEBHOOK_EVENT_INVALID' })

    const event = {
      tenantId: 'account-1',
      type: 'order.completed.v1' as const,
      eventId: 'order-event-1',
      subject: 'order-1',
      data: { orderId: 'order-1', total: 4200 },
    }
    const published = await fixture.subscriptions.publish(event)
    expect(published).toMatchObject({
      ok: true,
      matchedSubscriptions: 1,
      enqueuedDeliveries: 1,
      duplicateDeliveries: 0,
    })
    const duplicate = await fixture.subscriptions.publish(event)
    expect(duplicate).toMatchObject({
      ok: true,
      matchedSubscriptions: 1,
      enqueuedDeliveries: 0,
      duplicateDeliveries: 1,
    })

    const deliveries = await fixture.store.listDeliveries({
      tenantId: 'account-1',
      subscriptionId: 'sub-1',
    })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      messageId: 'order-event-1',
      eventType: 'order.completed.v1',
      secret: secretOne,
    })
    expect(JSON.parse(deliveries[0]?.body ?? '')).toMatchObject({
      type: 'order.completed.v1',
      subject: 'order-1',
      data: { orderId: 'order-1', total: 4200 },
    })
  })

  it('signs exact stored bytes and retries transient responses with one stable message id', async () => {
    const requests: Request[] = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return requests.length === 1
        ? new Response(null, { status: 503, headers: { 'retry-after': '10' } })
        : new Response(null, { status: 204 })
    }) as typeof fetch
    const fixture = createFixture(fetcher)
    await createSubscription(fixture)
    await fixture.subscriptions.publish({
      tenantId: 'account-1',
      type: 'order.completed.v1',
      eventId: 'order-event-1',
      data: { orderId: 'order-1', total: 4200 },
    })

    const first = await fixture.subscriptions.work()
    expect(first).toMatchObject({
      claimed: 1,
      outcomes: [
        {
          status: 'retrying',
          attemptCount: 1,
          responseStatus: 503,
          nextAttemptAt: Date.parse('2026-08-19T12:00:10.000Z'),
        },
      ],
    })
    expect(vi.mocked(fetcher).mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    const firstRequest = requests[0]
    if (firstRequest === undefined) throw new Error('first webhook request was not captured')
    const firstBody = await firstRequest.text()
    expect(firstRequest.headers.get('webhook-id')).toBe('order-event-1')
    const firstTimestamp = firstRequest.headers.get('webhook-timestamp')
    if (firstTimestamp === null) throw new Error('webhook timestamp was not set')
    expect(firstRequest.headers.get('webhook-signature')).toBe(
      new Webhook(secretOne).sign(
        'order-event-1',
        new Date(Number(firstTimestamp) * 1000),
        firstBody,
      ),
    )

    fixture.advance(9_999)
    expect(await fixture.subscriptions.work()).toMatchObject({ claimed: 0 })
    fixture.advance(1)
    const second = await fixture.subscriptions.work()
    expect(second).toMatchObject({
      claimed: 1,
      outcomes: [{ status: 'succeeded', attemptCount: 2, responseStatus: 204 }],
    })
    const secondRequest = requests[1]
    if (secondRequest === undefined) throw new Error('second webhook request was not captured')
    expect(secondRequest.headers.get('webhook-id')).toBe('order-event-1')
    expect(await secondRequest.text()).toBe(firstBody)

    const deliveries = await fixture.store.listDeliveries({
      tenantId: 'account-1',
      subscriptionId: 'sub-1',
    })
    expect(deliveries[0]).toMatchObject({ status: 'succeeded', attemptCount: 2 })
  })

  it('defers paused subscriptions and disables endpoints that return 410', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 410 })) as typeof fetch
    const fixture = createFixture(fetcher)
    await createSubscription(fixture)
    await fixture.store.updateSubscription('account-1', 'sub-1', {
      status: 'paused',
      updatedAt: Date.parse('2026-08-19T12:00:00.000Z'),
    })
    await fixture.subscriptions.publish({
      tenantId: 'account-1',
      type: 'order.completed.v1',
      data: { orderId: 'order-1', total: 1 },
    })
    const deferred = await fixture.subscriptions.work()
    expect(deferred).toMatchObject({ claimed: 0 })

    // Publish only matches active subscriptions, so make the existing queued record through the store.
    const active = await fixture.store.updateSubscription('account-1', 'sub-1', {
      status: 'active',
      updatedAt: Date.parse('2026-08-19T12:00:00.000Z'),
    })
    expect(active).toBeDefined()
    await fixture.subscriptions.publish({
      tenantId: 'account-1',
      type: 'order.completed.v1',
      eventId: 'gone-event',
      data: { orderId: 'order-1', total: 1 },
    })
    await fixture.store.updateSubscription('account-1', 'sub-1', {
      status: 'paused',
      updatedAt: Date.parse('2026-08-19T12:00:00.000Z'),
    })
    expect(await fixture.subscriptions.work()).toMatchObject({
      claimed: 1,
      outcomes: [{ status: 'deferred', attemptCount: 0 }],
    })
    expect(fetcher).not.toHaveBeenCalled()

    await fixture.store.updateSubscription('account-1', 'sub-1', {
      status: 'active',
      updatedAt: Date.parse('2026-08-19T12:01:00.000Z'),
    })
    fixture.advance(60_000)
    expect(await fixture.subscriptions.work()).toMatchObject({
      outcomes: [{ status: 'failed', responseStatus: 410 }],
    })
    expect(await fixture.store.getSubscription('account-1', 'sub-1')).toMatchObject({
      status: 'disabled',
      disabledReason: 'endpoint returned HTTP 410 Gone',
    })

    const deliveryLog = await resource(
      fixture.subscriptions,
      'GET',
      '/api/order-webhooks/:subscriptionId/deliveries',
    ).handle(
      request('https://api.example.test/api/order-webhooks/sub-1/deliveries', {
        token: 'account-1',
      }),
    )
    const deliveryLogText = await deliveryLog.text()
    expect(deliveryLogText).not.toContain(secretOne)
    const failedDelivery = (
      JSON.parse(deliveryLogText) as {
        readonly data: readonly Record<string, unknown>[]
      }
    ).data[0]
    expect(failedDelivery).toMatchObject({ status: 'failed' })
    expect(failedDelivery).not.toHaveProperty('body')
    expect(failedDelivery).not.toHaveProperty('secret')

    const retried = await resource(
      fixture.subscriptions,
      'POST',
      '/api/order-webhooks/:subscriptionId/deliveries/:deliveryId/retry',
    ).handle(
      request(
        `https://api.example.test/api/order-webhooks/sub-1/deliveries/${failedDelivery?.id}/retry`,
        { method: 'POST', token: 'account-1' },
      ),
    )
    expect(retried.status).toBe(202)
    await expect(retried.json()).resolves.toMatchObject({
      data: { id: failedDelivery?.id, status: 'queued', attemptCount: 0 },
    })
  })

  it('rechecks the endpoint policy immediately before network access', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch
    const fixture = createFixture(fetcher, ({ phase }) => phase !== 'deliver')
    await createSubscription(fixture)
    await fixture.subscriptions.publish({
      tenantId: 'account-1',
      type: 'order.completed.v1',
      data: { orderId: 'order-1', total: 1 },
    })

    expect(await fixture.subscriptions.work()).toMatchObject({
      claimed: 1,
      outcomes: [{ status: 'failed', error: expect.stringContaining('endpoint rejected') }],
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await fixture.store.getSubscription('account-1', 'sub-1')).toMatchObject({
      status: 'disabled',
    })
  })

  it('reclaims an expired delivery lease after a worker crash', async () => {
    const fixture = createFixture()
    await createSubscription(fixture)
    await fixture.subscriptions.publish({
      tenantId: 'account-1',
      type: 'order.completed.v1',
      data: { orderId: 'order-1', total: 1 },
    })
    expect(
      await fixture.store.claimDeliveries({
        now: Date.parse('2026-08-19T12:00:00.000Z'),
        limit: 1,
        leaseId: 'crashed-worker',
        leaseExpiresAt: Date.parse('2026-08-19T12:00:02.000Z'),
      }),
    ).toHaveLength(1)
    expect(await fixture.subscriptions.work()).toMatchObject({ claimed: 0 })
    fixture.advance(2_000)
    expect(await fixture.subscriptions.work()).toMatchObject({
      claimed: 1,
      outcomes: [{ status: 'succeeded' }],
    })
  })
})

describe('createHTTP outbound integration', () => {
  it('mounts subscription management routes without requiring incoming receivers or a run API', () => {
    const fixture = createFixture()
    const builder = defineFlow({ name: 'orders', context: z.object({}) })
    const flow = builder.steps({ done: builder.final() })
    const http = createHTTP(flow, { outbound: fixture.subscriptions })

    expect(http.outbound).toBe(fixture.subscriptions)
    expect(http.receivers).toEqual([])
    expect(http.resources).toHaveLength(8)
  })
})

// Keep public store records structurally nameable in declaration emit.
const _delivery: WebhookDelivery | undefined = undefined
const _subscription: WebhookSubscription | undefined = undefined
void _delivery
void _subscription
