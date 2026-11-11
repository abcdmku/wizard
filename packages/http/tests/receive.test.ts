import type { Run } from '@openwizard/core'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { describe, expect, it } from 'vitest'
import { createHTTP, type RunHandle, signWebhook } from '../src'
import { type Orders, orders } from './fixtures/orders'

const secret = `whsec_${btoa('receiver signing secret')}`
const next = `whsec_${btoa('next receiver signing secret')}`
const envelope = {
  type: 'payment.captured',
  timestamp: '2026-10-03T12:00:00.000Z',
  subject: 'o-1',
  data: { amount: 4200 },
}

async function delivery(
  body: object = envelope,
  options: { readonly id?: string; readonly secret?: string; readonly at?: Date } = {},
): Promise<Request> {
  const text = JSON.stringify(body)
  const headers = await signWebhook({
    secret: options.secret ?? secret,
    id: options.id ?? 'msg-1',
    body: text,
    ...(options.at === undefined ? {} : { timestamp: options.at }),
  })
  return new Request('https://api.test/webhooks/orders/payment.captured', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: text,
  })
}

/** A run of `orders` past its review, waiting for `payment.captured`. */
async function awaitingPayment(): Promise<Run<Orders>> {
  const run = orders.create({ orderId: 'o-1', secret: 's' }, { instanceId: 'o-1' })
  await run.start()
  await run.setInput('review', { note: 'gift' })
  await run.next()
  return run
}

function receiver(resolve: () => RunHandle<Orders> | Promise<RunHandle<Orders>>) {
  return createHTTP(orders, {
    receive: { events: ['payment.captured'], secret: [secret, next], resolve },
  })
}

describe('signed receivers', () => {
  it('delivers a verified event to the resolved run', async () => {
    const run = await awaitingPayment()
    const response = await receiver(() => run).fetch(await delivery())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { delivered: ['payment'], buffered: false },
    })
    expect(run.getState().status).toBe('done')
  })

  it('refuses a tampered body and a stale signature before resolving a run', async () => {
    const http = receiver(() => {
      throw new Error('a refused delivery must not resolve a run')
    })
    const signed = await delivery()
    const tampered = new Request(signed, {
      body: JSON.stringify({ ...envelope, data: { amount: 1 } }),
    })
    const stale = await delivery(envelope, { at: new Date(Date.now() - 10 * 60_000) })
    for (const request of [tampered, stale]) {
      const response = await http.fetch(request)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        ok: false,
        code: 'WEBHOOK_INVALID_SIGNATURE',
        message: 'the webhook signature is missing, stale or invalid',
      })
    }
  })

  it('accepts any listed secret during a rotation', async () => {
    const run = await awaitingPayment()
    const response = await receiver(() => run).fetch(await delivery(envelope, { secret: next }))
    expect(response.status).toBe(200)
  })

  it('accepts one webhook-id once, also across processes', async () => {
    const run = await awaitingPayment()
    const http = receiver(() => run)
    const first = await http.fetch(await delivery())
    const text = await first.text()
    const again = await http.fetch(await delivery())
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(await again.text()).toBe(text)
    // Another process has its own idempotency store; the run remembers the webhook-id.
    const elsewhere = await receiver(() => run).fetch(await delivery())
    expect(await elsewhere.json()).toEqual({
      ok: true,
      data: { delivered: [], buffered: false, seq: run.getState().seq, duplicate: true },
    })
  })

  it('delivers the provider retry of a webhook that first reached a disposed run', async () => {
    let run = await awaitingPayment()
    const snapshot = run.getSnapshot()
    const http = receiver(() => run)
    run.dispose() // a shutdown races the delivery
    const refused = await http.fetch(await delivery())
    expect([refused.status, refused.headers.get('retry-after'), await refused.json()]).toEqual([
      503,
      '1',
      {
        ok: false,
        code: 'RUN_UNAVAILABLE',
        message: 'the run was disposed before it took the request; retry shortly',
      },
    ])
    run = orders.resume(snapshot) // live again, e.g. after a restart
    expect((await http.fetch(await delivery())).status).toBe(200)
    expect(run.getState().status).toBe('done')
  })

  it('delivers the provider retry of a webhook that arrived before the run started', async () => {
    const run = orders.create({ orderId: 'o-1', secret: 's' }, { instanceId: 'o-1' })
    const http = receiver(() => run)
    const early = await http.fetch(await delivery())
    expect([early.status, early.headers.get('retry-after')]).toEqual([409, '1'])
    expect(await early.json()).toMatchObject({ code: 'FLOW_NOT_STARTED' })
    await run.start()
    await run.setInput('review', { note: 'gift' })
    await run.next()
    expect((await http.fetch(await delivery())).status).toBe(200)
    expect(run.getState().status).toBe('done')
  })

  it('stops reading an unsigned chunked body once it passes maxBodyBytes', async () => {
    let sent = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 1024 * 1024) return controller.close()
        sent += 1024
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const http = createHTTP(orders, {
      receive: {
        events: ['payment.captured'],
        secret,
        resolve: () => orders.create({ orderId: 'o-1', secret: 's' }),
        maxBodyBytes: 4096,
      },
    })
    // A streamed upload without Content-Length (Node needs `duplex`, which lib.dom does not type).
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    }
    const response = await http.fetch(
      new Request('https://api.test/webhooks/orders/payment.captured', init),
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      ok: false,
      code: 'BODY_TOO_LARGE',
      message: 'the request body exceeds 4096 bytes',
    })
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
    expect(sent).toBeLessThanOrEqual(8 * 1024)
  })

  it('refuses an envelope that names another event', async () => {
    const run = await awaitingPayment()
    const response = await receiver(() => run).fetch(
      await delivery({ ...envelope, type: 'payment.refunded' }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'WEBHOOK_EVENT_MISMATCH' })
  })

  it('dedupes a webhook-id through a durable host', async () => {
    const host = createDurableHost(orders, { store: createMemoryDurableStore() })
    const opened = await host.create('o-1', { orderId: 'o-1', secret: 's' })
    if (!opened.ok) throw new Error(opened.code)
    await opened.host.run.start()
    await opened.host.run.setInput('review', { note: 'gift' })
    await opened.host.run.next()
    const resolve = async () => {
      const found = await host.open('o-1')
      if (!found.ok) throw new Error(found.code)
      return found.host
    }
    expect(await (await receiver(resolve).fetch(await delivery())).json()).toMatchObject({
      ok: true,
      data: { delivered: ['payment'] },
    })
    expect(await (await receiver(resolve).fetch(await delivery())).json()).toMatchObject({
      ok: true,
      data: { delivered: [], duplicate: true },
    })
    await host.dispose()
  })

  it('receives only listed, declared events', () => {
    const resolve = () => orders.create({ orderId: 'o-1', secret: 's' })
    expect(() => createHTTP(orders, { receive: { events: [], secret, resolve } })).toThrow(
      'receive.events must list the events senders may deliver',
    )
    expect(() =>
      // @ts-expect-error only declared events can be received
      createHTTP(orders, { receive: { events: ['payment.refunded'], secret, resolve } }),
    ).toThrow("receive.events contains unknown event 'payment.refunded'")
  })
})
