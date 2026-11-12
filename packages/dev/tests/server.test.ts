import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Action, ActionResult, Catalog, RunDetail, RunSummary } from '../src/index'
import { type DevServer, startDevServer } from '../src/index'

let server: DevServer

beforeAll(async () => {
  server = await startDevServer({
    entry: fileURLToPath(new URL('./fixture.ts', import.meta.url)),
    port: 0,
    watch: false,
  })
})
afterAll(() => server.close())

const get = async <T>(path: string): Promise<T> =>
  (await fetch(server.url + path)).json() as Promise<T>
const post = async <T>(path: string, body: unknown): Promise<T> =>
  (
    await fetch(server.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json() as Promise<T>

const start = async (wizard: string, input: unknown): Promise<string> => {
  const started = await post<ActionResult & { id?: string }>('/api/runs', { wizard, input })
  expect(started).toMatchObject({ ok: true })
  return started.id as string
}
const act = (id: string, action: Action) => post<ActionResult>(`/api/runs/${id}/actions`, action)
const detail = (id: string) => get<RunDetail>(`/api/runs/${id}`)
const kinds = (run: RunDetail) =>
  run.pending.map((item) =>
    item.kind === 'call' ? `call ${item.name}` : `${item.kind} ${item.step}`,
  )

it('lists the wizards of the entry file with their graph, page and starting input', async () => {
  const catalog = await get<Catalog>('/api/catalog')
  expect(catalog.error).toBeUndefined()
  expect(catalog.wizards.map((wizard) => [wizard.name, wizard.hasDeps])).toEqual([
    ['refund', false],
    ['reminder', true],
  ])
  const [refund, reminder] = catalog.wizards
  expect(refund?.exampleInput).toEqual({ orderId: 'o-2' })
  expect(reminder?.exampleInput).toEqual({ to: '' })
  expect(refund?.manifest.nodes.map((node) => node.id)).toContain('managerApproval')
  expect(refund?.markdown).toContain('# refund')
  expect(refund?.events).toEqual({ 'refund.approved': { source: 'webhook', from: 'Back office' } })
  expect(reminder?.services).toEqual(['mail'])
})

it('refuses an input the context schema rejects', async () => {
  const refused = await post<ActionResult>('/api/runs', { wizard: 'refund', input: {} })
  expect(refused.ok).toBe(false)
  expect(refused.issues?.length).toBeGreaterThan(0)
})

it('drives a refund by hand: form, service calls, event and result', async () => {
  const id = await start('refund', { orderId: 'o-2' })
  let run = await detail(id)
  expect(run.services).toBe('manual')
  expect(kinds(run).sort()).toEqual(['call orders.find', 'view request'])

  const refusedDraft = await act(id, {
    type: 'submit',
    path: [],
    step: 'request',
    input: { amount: -5 },
  })
  expect(refusedDraft.ok).toBe(false)
  expect(refusedDraft.issues?.length).toBeGreaterThan(0)

  expect(
    await act(id, { type: 'submit', path: [], step: 'request', input: { amount: 900 } }),
  ).toEqual({ ok: true })
  const call = (await detail(id)).pending.find((item) => item.kind === 'call')
  expect(call).toMatchObject({ name: 'orders.find', args: ['o-2'] })
  await act(id, { type: 'resolve', id: (call as { id: string }).id, value: { total: 250 } })

  run = await detail(id)
  expect(kinds(run)).toEqual(['event managerApproval'])
  expect(run.pending[0]).toMatchObject({
    events: [{ name: 'refund.approved', origin: { source: 'webhook', from: 'Back office' } }],
  })
  expect((await act(id, { type: 'send', event: 'refund.approved', payload: {} })).ok).toBe(false)
  expect(
    await act(id, { type: 'send', event: 'refund.approved', payload: { by: 'grace' } }),
  ).toEqual({ ok: true })

  const pay = (await detail(id)).pending.find((item) => item.kind === 'call')
  expect(pay).toMatchObject({ name: 'payments.refund', args: ['o-2', 250] })
  await act(id, { type: 'resolve', id: (pay as { id: string }).id, value: { refundId: 'r-1' } })

  run = await detail(id)
  expect(run.result).toMatchObject({
    status: 'done',
    output: { refundId: 'r-1', amount: 250, approvedBy: 'grace' },
  })
  expect(run.events.length).toBeGreaterThan(5)
  expect((await get<RunSummary[]>('/api/runs')).map((item) => item.id)).toContain(id)
})

it('opens each editor with the example from the dev config', async () => {
  const id = await start('refund', { orderId: 'o-5' })
  let run = await detail(id)
  expect(run.pending.find((item) => item.kind === 'view')).toMatchObject({
    draft: { amount: 900 },
  })
  const call = run.pending.find((item) => item.kind === 'call') as { id: string }
  expect(call).toMatchObject({ name: 'orders.find', example: { total: 250 } })

  await act(id, { type: 'submit', path: [], step: 'request', input: { amount: 900 } })
  await act(id, { type: 'resolve', id: call.id, value: { total: 250 } })
  run = await detail(id)
  expect(run.pending[0]).toMatchObject({
    events: [{ name: 'refund.approved', example: { by: 'grace' } }],
  })
})

it('stops a run and resumes it from its snapshot with finished steps kept', async () => {
  const id = await start('refund', { orderId: 'o-6' })
  await act(id, { type: 'submit', path: [], step: 'request', input: { amount: 900 } })
  const call = (await detail(id)).pending.find((item) => item.kind === 'call') as { id: string }
  await act(id, { type: 'resolve', id: call.id, value: { total: 250 } })
  expect(kinds(await detail(id))).toEqual(['event managerApproval'])
  const before = (await detail(id)).events.length

  expect(await act(id, { type: 'restart' })).toEqual({ ok: true })
  const run = await detail(id)
  expect(run.id).toBe(id)
  expect(kinds(run)).toEqual(['event managerApproval'])
  expect(run.events.length).toBeGreaterThanOrEqual(before)

  await act(id, { type: 'send', event: 'refund.approved', payload: { by: 'grace' } })
  const pay = (await detail(id)).pending.find((item) => item.kind === 'call') as { id: string }
  await act(id, { type: 'resolve', id: pay.id, value: { refundId: 'r-9' } })
  expect((await detail(id)).result).toMatchObject({
    status: 'done',
    output: { refundId: 'r-9', amount: 250, approvedBy: 'grace' },
  })
})

it('halts on a rejected service call and retries the step', async () => {
  const id = await start('refund', { orderId: 'o-3' })
  const call = (await detail(id)).pending.find((item) => item.kind === 'call') as { id: string }
  await act(id, { type: 'reject', id: call.id, message: 'Orders is down' })

  let run = await detail(id)
  expect(run.status).toBe('halted')
  expect(kinds(run)).toContain('failed order')

  expect(await act(id, { type: 'retry', step: 'order' })).toEqual({ ok: true })
  run = await detail(id)
  expect(kinds(run)).toContain('call orders.find')
})

it('skips a sleep and runs the next step with real services', async () => {
  const id = await start('reminder', { to: 'ada@example.com' })
  let run = await detail(id)
  expect(run.services).toBe('real')
  expect(kinds(run)).toEqual(['sleep pause'])
  expect(run.nextTimer).toBeGreaterThan(run.now)

  expect(await act(id, { type: 'skipTimer' })).toEqual({ ok: true })
  await new Promise((done) => setTimeout(done, 20))
  run = await detail(id)
  expect(run.result).toMatchObject({ status: 'done', output: 'sent to ada@example.com' })
})

it('removes a run', async () => {
  const id = await start('reminder', { to: 'ada@example.com' })
  const removed = await fetch(`${server.url}/api/runs/${id}`, { method: 'DELETE' })
  expect(removed.status).toBe(200)
  expect((await fetch(`${server.url}/api/runs/${id}`)).status).toBe(404)
})

it('refuses a write from another origin and a request for another host', async () => {
  const foreign = await fetch(`${server.url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: '{}',
  })
  expect(foreign.status).toBe(403)
  const form = await fetch(`${server.url}/api/runs`, { method: 'POST', body: 'wizard=refund' })
  expect(form.status).toBe(403)
})
