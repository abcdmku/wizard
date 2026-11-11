import { defineWizard } from '@openwizard/core'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHTTP, createMemoryIdempotencyStore, type IdempotencyStore } from '../src'
import { auth, call, memoryRuns, orders } from './fixtures/orders'

const access = {
  context: ['orderId'],
  flow: ['create', 'read', 'cancel'],
  steps: { review: ['read', 'setInput'] },
  events: ['payment.captured'],
} as const

function ordersHTTP(runs = memoryRuns(), idempotency?: IdempotencyStore) {
  return createHTTP(orders, {
    runs,
    auth,
    access,
    ...(idempotency === undefined ? {} : { idempotency }),
  })
}

const order = { orderId: 'o-1', secret: 's3cret' }

/** Two events in sequence; an early event is dropped, not buffered. */
const signup = defineWizard(
  {
    name: 'signup',
    context: z.object({}),
    events: { 'email.verified': z.object({}), 'phone.verified': z.object({}) },
    unmatchedEvents: { buffer: false, ttl: '5m' },
  },
  ({ step, steps }) =>
    steps({
      email: step({ waitFor: { 'email.verified': () => undefined }, next: 'phone' }),
      phone: step({ waitFor: { 'phone.verified': () => undefined } }),
    }),
)

async function signupHTTP() {
  const run = signup.create({}, { instanceId: 's-1' })
  await run.start()
  const http = createHTTP(signup, {
    runs: { get: () => run },
    auth,
    access: { events: ['email.verified', 'phone.verified'] },
    scopes: { command: ['orders:command'] },
  })
  const send = (event: 'email.verified' | 'phone.verified', key: string) =>
    http.fetch(
      call(`/api/signup/s-1/events/${event}`, {
        token: 'alice',
        body: {},
        headers: { 'idempotency-key': key },
      }),
    )
  return { run, send }
}

describe('createHTTP run API', () => {
  it('exposes nothing that access does not list', () => {
    expect(() => createHTTP(orders, { runs: memoryRuns(), auth, access: {} })).toThrow(
      'access exposes no route',
    )
    expect(() =>
      // @ts-expect-error runs, auth and access turn the run API on together
      createHTTP(orders, { runs: memoryRuns(), auth }),
    ).toThrow('the run API needs runs, auth and access together')
    expect(ordersHTTP().resources.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/orders',
      'GET /api/orders/:runId',
      'GET /api/orders/:runId/stream',
      'GET /api/orders/:runId/steps/:step',
      'POST /api/orders/:runId/commands',
      'POST /api/orders/:runId/events/payment.captured',
      'POST /api/orders/:runId/stream',
    ])
  })

  it('creates a run, replays its Idempotency-Key, and refuses the key for another body', async () => {
    const http = ordersHTTP()
    const create = (body: unknown) =>
      http.fetch(
        call('/api/orders', { token: 'alice', body, headers: { 'idempotency-key': 'k-1' } }),
      )
    const created = await create(order)
    const text = await created.text()
    expect(created.status).toBe(201)
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: {
        instanceId: 'k-1',
        status: 'waiting',
        current: 'review',
        context: { orderId: 'o-1' },
      },
    })
    const replayed = await create(order)
    expect(replayed.status).toBe(201)
    expect(replayed.headers.get('idempotent-replayed')).toBe('true')
    expect(await replayed.text()).toBe(text)
    const conflict = await create({ ...order, orderId: 'o-2' })
    expect(conflict.status).toBe(422)
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('answers input outside the context schema with 422 and its issues', async () => {
    const response = await ordersHTTP().fetch(
      call('/api/orders', { token: 'alice', body: { orderId: 7, secret: 's' } }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'BOUNDARY_REJECTED',
      issues: [{ path: ['orderId'] }],
    })
  })

  it("serves only the caller's tenant and scopes", async () => {
    const runs = memoryRuns()
    const http = ordersHTTP(runs)
    await http.fetch(
      call('/api/orders', { token: 'alice', body: order, headers: { 'idempotency-key': 'o-1' } }),
    )
    expect((await http.fetch(call('/api/orders/o-1', { token: 'alice' }))).status).toBe(200)
    expect((await http.fetch(call('/api/orders/o-1', { token: 'bob' }))).status).toBe(404)
    expect((await http.fetch(call('/api/orders/o-1', { token: 'reader' }))).status).toBe(200)
    const command = await http.fetch(
      call('/api/orders/o-1/commands', { token: 'reader', body: { type: 'cancel' } }),
    )
    expect(command.status).toBe(403)
    expect(await command.json()).toEqual({
      ok: false,
      code: 'INSUFFICIENT_SCOPE',
      message: 'the caller lacks a required scope',
      requiredScopes: ['orders:command'],
    })
  })

  it('reads exposed steps only', async () => {
    const runs = memoryRuns()
    const http = ordersHTTP(runs)
    await http.fetch(
      call('/api/orders', { token: 'alice', body: order, headers: { 'idempotency-key': 'o-1' } }),
    )
    const review = await http.fetch(call('/api/orders/o-1/steps/review', { token: 'alice' }))
    expect(await review.json()).toEqual({
      ok: true,
      data: { id: 'review', kind: 'view', status: 'active', phase: 'waiting', attempt: 0 },
    })
    const ship = await http.fetch(call('/api/orders/o-1/steps/ship', { token: 'alice' }))
    expect(ship.status).toBe(404)
  })

  it('applies listed commands and refuses the others', async () => {
    const runs = memoryRuns()
    const run = runs.add('acme', orders.create(order, { instanceId: 'o-1' }))
    await run.start()
    const http = ordersHTTP(runs)
    const command = (body: unknown) =>
      http.fetch(call('/api/orders/o-1/commands', { token: 'alice', body }))
    const skip = await command({ type: 'skip', step: 'payment' })
    expect(skip.status).toBe(403)
    expect(await skip.json()).toMatchObject({ code: 'COMMAND_NOT_ALLOWED' })
    const draft = await command({ type: 'setInput', step: 'review', patch: { note: 'gift' } })
    expect(draft.status).toBe(200)
    expect(await draft.json()).toEqual({ ok: true, data: { seq: run.getState().seq } })
    expect(run.getState().steps.review.input).toEqual({ note: 'gift' })
    expect((await command({ type: 'cancel' })).status).toBe(200)
    expect(run.getState().status).toBe('cancelled')
  })

  it('keeps an Idempotency-Key free when its run did not exist yet', async () => {
    const runs = memoryRuns()
    const http = ordersHTTP(runs)
    const cancel = () =>
      http.fetch(
        call('/api/orders/o-1/commands', {
          token: 'alice',
          body: { type: 'cancel' },
          headers: { 'idempotency-key': 'cancel-1' },
        }),
      )
    expect((await cancel()).status).toBe(404)
    runs.add('acme', orders.create(order, { instanceId: 'o-1' }))
    const applied = await cancel()
    expect(applied.status).toBe(200)
    expect(applied.headers.get('idempotent-replayed')).toBeNull()
  })

  it('delivers an event once per Idempotency-Key, even through another process', async () => {
    const runs = memoryRuns()
    const run = runs.add('acme', orders.create(order, { instanceId: 'o-1' }))
    await run.start()
    await run.setInput('review', { note: 'gift' })
    await run.next()
    const send = (http: ReturnType<typeof ordersHTTP>) =>
      http.fetch(
        call('/api/orders/o-1/events/payment.captured', {
          token: 'alice',
          body: { amount: 4200 },
          headers: { 'idempotency-key': 'pay-1' },
        }),
      )
    const http = ordersHTTP(runs)
    const first = await send(http)
    const text = await first.text()
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: { delivered: ['payment'], buffered: false },
    })
    const replayed = await send(http)
    expect(replayed.headers.get('idempotent-replayed')).toBe('true')
    expect(await replayed.text()).toBe(text)
    // A second process has its own idempotency store; the run itself remembers the event id.
    expect(await (await send(ordersHTTP(runs))).json()).toEqual({
      ok: true,
      data: { delivered: [], buffered: false, seq: run.getState().seq, duplicate: true },
    })
  })

  it('replays the first answer to a repeated Idempotency-Key, a refusal included', async () => {
    const { send } = await signupHTTP()
    const early = await send('phone.verified', 'early')
    const text = await early.text()
    expect(early.status).toBe(409)
    const again = await send('phone.verified', 'early')
    expect(again.status).toBe(409)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(await again.text()).toBe(text)
  })

  it('keeps one Idempotency-Key apart on two event routes of a run', async () => {
    const { run, send } = await signupHTTP()
    expect((await send('email.verified', 'x')).status).toBe(200)
    expect(await (await send('phone.verified', 'x')).json()).toMatchObject({
      ok: true,
      data: { delivered: ['phone'] },
    })
    expect(run.getState().status).toBe('done')
  })

  it('answers an event payload outside its schema with 422', async () => {
    const runs = memoryRuns()
    runs.add('acme', orders.create(order, { instanceId: 'o-1' }))
    const response = await ordersHTTP(runs).fetch(
      call('/api/orders/o-1/events/payment.captured', { token: 'alice', body: { amount: 'all' } }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'BOUNDARY_REJECTED',
      issues: [{ path: ['amount'] }],
    })
  })

  it('scopes Idempotency-Keys per API when APIs share a store', async () => {
    const idempotency = createMemoryIdempotencyStore()
    const eu = createHTTP(orders, {
      id: 'orders-eu',
      runs: memoryRuns(),
      auth,
      access,
      scopes: { create: ['orders:create'] },
      idempotency,
    })
    const key = { 'idempotency-key': 'same' }
    const us = await ordersHTTP(memoryRuns(), idempotency).fetch(
      call('/api/orders', { token: 'alice', body: order, headers: key }),
    )
    const other = await eu.fetch(
      call('/api/orders-eu', { token: 'alice', body: order, headers: key }),
    )
    expect(us.status).toBe(201)
    expect(other.status).toBe(201)
    expect(other.headers.get('idempotent-replayed')).toBeNull()
  })

  it('sends events through a durable host and maps its boundary rejection to 422', async () => {
    const host = createDurableHost(orders, { store: createMemoryDurableStore() })
    const opened = await host.create('o-1', order)
    if (!opened.ok) throw new Error(opened.code)
    await opened.host.run.start()
    await opened.host.run.setInput('review', { note: 'gift' })
    await opened.host.run.next()
    const http = createHTTP(orders, {
      runs: {
        get: async ({ runId }) => {
          const found = await host.open(runId)
          return found.ok ? found.host : undefined
        },
      },
      auth,
      access: { flow: ['read'], events: ['payment.captured'] },
    })
    const send = (body: unknown) =>
      http.fetch(call('/api/orders/o-1/events/payment.captured', { token: 'alice', body }))
    const rejected = await send({ amount: 'all' })
    expect(rejected.status).toBe(422)
    const accepted = await send({ amount: 4200 })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ ok: true, data: { delivered: ['payment'] } })
    await host.dispose()
  })

  it('answers CORS preflight for allowed origins only', async () => {
    const http = createHTTP(orders, {
      runs: memoryRuns(),
      auth,
      access,
      cors: { origins: ['https://app.test'] },
    })
    const preflight = await http.fetch(
      call('/api/orders/o-1/stream', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.test' },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(Object.fromEntries(preflight.headers)).toMatchObject({
      allow: 'GET, POST, OPTIONS',
      'access-control-allow-origin': 'https://app.test',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, idempotency-key, last-event-id',
    })
    const foreign = await http.fetch(
      call('/api/orders/o-1', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }),
    )
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
  })
})
