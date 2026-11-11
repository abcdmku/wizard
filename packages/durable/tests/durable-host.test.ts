import { boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { expect, it } from 'vitest'

const flow = defineWizard(
  {
    name: 'durable-host-order',
    context: boundary.trusted<{ readonly order: string }>(),
    events: { paid: boundary.trusted<{ readonly amount: number }>() },
    deps: boundary.trusted<{ readonly region: string }>(),
  },
  ({ step, steps }) =>
    steps(
      {
        pay: step({ waitFor: { paid: () => undefined }, next: 'ship' }),
        ship: step({
          run: ({ context, deps }) => `${context.order} ships from ${deps.region}`,
          next: 'done',
        }),
        done: step({ next: null }),
      },
      { start: 'pay' },
    ),
)

function setup(ownerId: string, store: DurableStore, scheduler: TestScheduler) {
  const lost: string[] = []
  const durable = createDurableHost(flow, {
    store,
    scheduler,
    ownerId,
    renew: 'manual',
    deps: (key) => ({ region: key.startsWith('eu/') ? 'eu-west' : 'us-east' }),
    onLeaseLost: (key, code) => lost.push(`${key}: ${code}`),
  })
  return { durable, lost }
}

async function tick(count = 10): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

it('opens each key once and routes commands and events to its run', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const { durable } = setup('worker-a', createMemoryDurableStore({ now: scheduler.now }), scheduler)
  const created = await durable.create('eu/order-1', { order: 'A-1' })
  if (!created.ok) throw new Error(created.code)
  expect(await durable.open('eu/order-1')).toEqual({ ok: true, host: created.host })

  expect(
    await durable.dispatch('eu/order-1', { type: 'start' }, { commandId: 'start' }),
  ).toMatchObject({ ok: true, status: 'applied' })
  expect(
    await durable.send('eu/order-1', 'paid', { amount: 10 }, { eventId: 'payment-1' }),
  ).toMatchObject({ ok: true, delivered: ['pay'] })
  await created.host.run.awaitResult()
  expect(created.host.run.getState().steps.ship.output).toBe('A-1 ships from eu-west')
  await durable.dispose()
})

it('uses wizard-provided dependencies when creating and reopening a run', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const wizard = flow.provide({ region: 'provided-region' })
  const first = createDurableHost(wizard, {
    store,
    scheduler,
    ownerId: 'worker-a',
    renew: 'manual',
  })
  const created = await first.create('order-provided', { order: 'P-1' })
  if (!created.ok) throw new Error(created.code)
  await first.dispatch('order-provided', { type: 'start' }, { commandId: 'start' })
  await first.dispose()

  const second = createDurableHost(wizard, {
    store,
    scheduler,
    ownerId: 'worker-b',
    renew: 'manual',
  })
  const reopened = await second.open('order-provided')
  if (!reopened.ok) throw new Error(reopened.code)
  expect(
    await second.send('order-provided', 'paid', { amount: 10 }, { eventId: 'payment' }),
  ).toMatchObject({ ok: true, delivered: ['pay'] })
  await reopened.host.run.awaitResult()
  expect(reopened.host.run.getState().steps.ship.output).toBe('P-1 ships from provided-region')
  await second.dispose()
})

it('releases a finished run and reopens it for a late delivery', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const { durable } = setup('worker-a', store, scheduler)
  const created = await durable.create('us/order-2', { order: 'B-2' })
  if (!created.ok) throw new Error(created.code)
  await durable.dispatch('us/order-2', { type: 'start' }, { commandId: 'start' })
  await durable.send('us/order-2', 'paid', { amount: 5 }, { eventId: 'payment-1' })
  await created.host.run.awaitResult()

  scheduler.advance(0)
  await tick()
  const probe = await store.acquire('us/order-2', 'probe')
  expect(probe.ok).toBe(true)
  if (probe.ok) await store.release(probe.lease)

  expect(
    await durable.send('us/order-2', 'paid', { amount: 5 }, { eventId: 'payment-1' }),
  ).toMatchObject({ ok: true, duplicate: true, delivered: [] })
  await durable.dispose()
})

it('drops a run whose lease moved to another worker and reports that worker busy', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now, leaseTtlMs: 10 })
  const a = setup('worker-a', store, scheduler)
  const b = setup('worker-b', store, scheduler)
  await a.durable.create('eu/order-3', { order: 'C-3' })
  await a.durable.dispatch('eu/order-3', { type: 'start' }, { commandId: 'start' })

  scheduler.advance(11)
  expect(await b.durable.open('eu/order-3')).toMatchObject({ ok: true })
  expect(
    await a.durable.send('eu/order-3', 'paid', { amount: 1 }, { eventId: 'payment-1' }),
  ).toEqual({
    ok: false,
    code: 'LEASE_LOST',
    message: 'this host no longer owns the run lease; reopen the run and retry',
  })
  expect(a.lost).toEqual(['eu/order-3: LEASE_LOST'])
  expect(
    await a.durable.send('eu/order-3', 'paid', { amount: 1 }, { eventId: 'payment-1' }),
  ).toEqual({ ok: false, code: 'LEASE_BUSY', retryAt: 21 })
  expect(
    await b.durable.send('eu/order-3', 'paid', { amount: 1 }, { eventId: 'payment-1' }),
  ).toMatchObject({ ok: true, delivered: ['pay'] })
  await a.durable.dispose()
  await b.durable.dispose()
})

it('releases every lease on dispose and refuses later calls', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const { durable } = setup('worker-a', store, scheduler)
  await durable.create('eu/order-4', { order: 'D-4' })
  await durable.create('us/order-5', { order: 'E-5' })
  await durable.dispose()

  expect(await store.acquire('eu/order-4', 'worker-b')).toMatchObject({ ok: true })
  expect(await store.acquire('us/order-5', 'worker-b')).toMatchObject({ ok: true })
  expect(await durable.open('eu/order-4')).toEqual({ ok: false, code: 'HOST_REGISTRY_DISPOSED' })
})
