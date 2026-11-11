import { createMirror } from '@openwizard/core/mirror'
import { createLocalTransport } from '@openwizard/core/testing'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { signWebhook } from '@openwizard/http'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { approval } from '../learn/wait'
import { Signup } from '../packages/react'
import { Checkout } from './client'
import { createStore, workflowTables } from './drizzle'
import { http } from './http'
import { checkout, type checkoutClient, serveCheckout } from './projection'
import { serveApproval } from './server'
import { tracedDashboard } from './tracing'

it('server: replays a repeated command and finishes the run', async () => {
  expect(await serveApproval()).toMatchObject({
    ok: true,
    started: { ok: true, status: 'applied' },
    repeated: { ok: true, status: 'replayed' },
    sent: { ok: true },
    result: { status: 'done', output: 'Approved by Grace' },
  })
})

it('server: a second process cannot open a run another process holds', async () => {
  const store = createMemoryDurableStore()
  const first = createDurableHost(approval, { store })
  const second = createDurableHost(approval, { store })
  await first.create('approvals/1', {})

  expect(await second.open('approvals/1')).toMatchObject({ ok: false, code: 'LEASE_BUSY' })
  expect(await second.open('approvals/missing')).toMatchObject({ ok: false, code: 'RUN_NOT_FOUND' })
  await first.dispose()
  await second.dispose()
})

it('server: defines the durable tables for Drizzle', () => {
  expect(Object.keys(workflowTables).length).toBeGreaterThan(0)
  expect(typeof createStore).toBe('function')
})

it('client: the mirror holds only projected state and refuses other commands', async () => {
  const run = checkout.create({ cartId: 'cart-42', total: 129.5 })
  await run.start()
  const mirror = createMirror<typeof checkoutClient>({
    transport: createLocalTransport(serveCheckout(run)),
  })

  expect(mirror.getSnapshot()).toMatchObject({ status: 'waiting', context: { total: 129.5 } })
  expect(JSON.stringify(mirror.getSnapshot())).not.toContain('cart-42')
  expect(await mirror.cancel()).toMatchObject({ ok: false, code: 'FORBIDDEN' })

  await mirror.setInput('payment', { cardToken: 'tok_demo' })
  expect(await mirror.next()).toMatchObject({ ok: true })
  await run.awaitResult()
  expect(mirror.getSnapshot()).toMatchObject({ status: 'done', output: { paid: 129.5 } })
  expect(JSON.stringify(mirror.getSnapshot())).not.toContain('tok_demo')
  mirror.dispose()
  run.dispose()
})

it('client: the React components render from a mirror and from a local run', async () => {
  const run = checkout.create({ cartId: 'cart-42', total: 129.5 })
  await run.start()
  const transport = createLocalTransport(serveCheckout(run))

  expect(renderToString(createElement(Checkout, { transport }))).toContain('129.5')
  expect(renderToString(createElement(Signup))).toContain('Continue')
  run.dispose()
})

it('http: creates a run, then a signed webhook finishes it', async () => {
  process.env.API_TOKEN = 'secret-token'
  const created = await http.fetch(
    new Request('https://api.test/api/approval', {
      method: 'POST',
      headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
      body: '{}',
    }),
  )
  expect(created.status).toBe(201)
  const { data } = (await created.json()) as { data: { instanceId: string } }
  const { instanceId } = data

  const body = JSON.stringify({
    type: 'approved',
    timestamp: new Date().toISOString(),
    subject: instanceId,
    data: { by: 'Grace' },
  })
  const signature = await signWebhook({
    secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    id: 'msg-1',
    body,
  })
  const delivered = await http.fetch(
    new Request('https://api.test/webhooks/approval/approved', {
      method: 'POST',
      headers: { ...signature, 'content-type': 'application/json' },
      body,
    }),
  )
  expect(delivered.status).toBeLessThan(300)

  const read = await http.fetch(
    new Request(`https://api.test/api/approval/${instanceId}`, {
      headers: { authorization: 'Bearer secret-token' },
    }),
  )
  expect(await read.json()).toMatchObject({ ok: true, data: { status: 'done' } })
  expect(
    (await http.fetch(new Request(`https://api.test/api/approval/${instanceId}`))).status,
  ).toBe(401)
})

it('tracing: an instrumented run still finishes', async () => {
  expect(await tracedDashboard()).toMatchObject({ status: 'done', output: 'User 7 has 2 orders' })
})
