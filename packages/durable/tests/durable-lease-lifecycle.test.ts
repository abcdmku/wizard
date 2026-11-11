import { boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { expect, it } from 'vitest'

const order = defineWizard(
  {
    name: 'durable-lease-lifecycle',
    context: boundary.trusted<{ readonly order: string }>(),
    events: { paid: boundary.trusted<{ readonly amount: number }>() },
    deps: boundary.trusted<{ readonly region: string }>(),
  },
  ({ step, steps }) =>
    steps({
      pay: step({ waitFor: { paid: ({ payload }) => ({ done: payload.amount }) }, next: 'ship' }),
      ship: step({ run: ({ context, deps }) => `${context.order} ships from ${deps.region}` }),
    }),
).provide({ region: 'eu-west' })

function setup(store: DurableStore, scheduler: TestScheduler, ownerId = 'worker-a') {
  return createDurableHost(order, { store, scheduler, ownerId, renew: 'manual' })
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushRelease(scheduler: TestScheduler) {
  scheduler.advance(0)
  for (let count = 0; count < 40; count += 1) await Promise.resolve()
}

it('keeps a terminal handle usable after an awaited delivery outlives lease release', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const durable = setup(store, scheduler)
  const created = await durable.create('order-1', { order: 'A-1' })
  if (!created.ok) throw new Error(created.code)
  await created.host.dispatch({ type: 'start' }, { commandId: 'start-1' })
  await created.host.send('paid', { amount: 10 }, { eventId: 'payment-1' })
  await created.host.run.awaitResult()

  const held = await durable.open('order-1')
  if (!held.ok) throw new Error(held.code)
  const io = deferred()
  const lateDelivery = io.promise.then(() =>
    held.host.send('paid', { amount: 10 }, { eventId: 'payment-1' }),
  )
  await flushRelease(scheduler)
  const acquired = await store.acquire('order-1', 'probe')
  expect(acquired.ok).toBe(true)
  if (!acquired.ok) throw new Error(acquired.code)
  await store.release(acquired.lease)

  io.resolve()
  await expect(lateDelivery).resolves.toMatchObject({ ok: true, duplicate: true, delivered: [] })
  expect(held.host.run.getState().status).toBe('done')
  expect(held.host.run.getState().steps.ship.output).toBe('A-1 ships from eu-west')
  await durable.dispose()
})

it('replays command ids through a reopened terminal handle after its own lease is released', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const durable = setup(store, scheduler)
  const created = await durable.create('order-2', { order: 'B-2' })
  if (!created.ok) throw new Error(created.code)
  const started = await created.host.dispatch({ type: 'start' }, { commandId: 'start-2' })
  await created.host.send('paid', { amount: 5 }, { eventId: 'payment-2' })
  await created.host.run.awaitResult()
  await flushRelease(scheduler)

  const held = await durable.open('order-2')
  if (!held.ok) throw new Error(held.code)
  const previousLease = held.host.lease
  await flushRelease(scheduler)
  await expect(held.host.dispatch({ type: 'start' }, { commandId: 'start-2' })).resolves.toEqual({
    ...started,
    status: 'replayed',
  })
  expect(held.host.lease.fence).not.toBe(previousLease.fence)
  expect(held.host.run.getState().steps.ship.output).toBe('B-2 ships from eu-west')
  await durable.dispose()
})

it('reserves a terminal generation before awaiting open and releases it after dispatch commits', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const base = createMemoryDurableStore({ now: scheduler.now })
  const claimStarted = deferred()
  const finishClaim = deferred()
  let delayReplay = false
  const store = {
    ...base,
    async claimDedupe(input) {
      if (delayReplay) {
        claimStarted.resolve()
        await finishClaim.promise
      }
      return base.claimDedupe(input)
    },
  } satisfies DurableStore
  const durable = setup(store, scheduler)
  const created = await durable.create('order-3', { order: 'C-3' })
  if (!created.ok) throw new Error(created.code)
  const started = await created.host.dispatch({ type: 'start' }, { commandId: 'start-3' })
  await created.host.send('paid', { amount: 3 }, { eventId: 'payment-3' })
  await created.host.run.awaitResult()

  delayReplay = true
  const replay = created.host.dispatch({ type: 'start' }, { commandId: 'start-3' })
  // The dispatch has reserved its key but has not resumed from its first await yet.
  scheduler.advance(0)
  await claimStarted.promise
  expect(await base.acquire('order-3', 'probe')).toEqual({
    ok: false,
    code: 'LEASE_BUSY',
    retryAt: base.leaseTtlMs,
  })
  finishClaim.resolve()
  await expect(replay).resolves.toEqual({ ...started, status: 'replayed' })

  await flushRelease(scheduler)
  const acquired = await base.acquire('order-3', 'probe')
  expect(acquired.ok).toBe(true)
  if (acquired.ok) await base.release(acquired.lease)
  await durable.dispose()
})

it('preserves competing-owner failures after automatically releasing a held terminal handle', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const durable = setup(store, scheduler)
  const created = await durable.create('order-4', { order: 'D-4' })
  if (!created.ok) throw new Error(created.code)
  await created.host.dispatch({ type: 'start' }, { commandId: 'start-4' })
  await created.host.send('paid', { amount: 4 }, { eventId: 'payment-4' })
  await created.host.run.awaitResult()
  await flushRelease(scheduler)
  const competing = await store.acquire('order-4', 'worker-b')
  if (!competing.ok) throw new Error(competing.code)

  await expect(
    created.host.send('paid', { amount: 4 }, { eventId: 'payment-4' }),
  ).resolves.toMatchObject({ ok: false, code: 'LEASE_LOST' })
  await expect(
    durable.send('order-4', 'paid', { amount: 4 }, { eventId: 'payment-4' }),
  ).resolves.toEqual({ ok: false, code: 'LEASE_BUSY', retryAt: competing.lease.expiresAt })
  await store.release(competing.lease)
  await expect(
    created.host.send('paid', { amount: 4 }, { eventId: 'payment-4' }),
  ).resolves.toMatchObject({ ok: true, duplicate: true, delivered: [] })
  await durable.dispose()
})

it('keeps an explicitly released handle closed while allowing its key to reopen', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const durable = setup(store, scheduler)
  const created = await durable.create('order-5', { order: 'E-5' })
  if (!created.ok) throw new Error(created.code)
  await expect(created.host.release()).resolves.toEqual({ ok: true })
  await expect(
    created.host.dispatch({ type: 'start' }, { commandId: 'start-5' }),
  ).resolves.toMatchObject({ ok: false, code: 'LEASE_LOST' })

  const reopened = await durable.open('order-5')
  if (!reopened.ok) throw new Error(reopened.code)
  await expect(
    reopened.host.dispatch({ type: 'start' }, { commandId: 'start-5' }),
  ).resolves.toMatchObject({ ok: true, status: 'applied' })
  await durable.dispose()
  await expect(
    reopened.host.send('paid', { amount: 5 }, { eventId: 'payment-5' }),
  ).resolves.toMatchObject({ ok: false, code: 'LEASE_LOST' })
  await expect(durable.open('order-5')).resolves.toEqual({
    ok: false,
    code: 'HOST_REGISTRY_DISPOSED',
  })
})

it('waits for an already issued operation to reacquire its generation before explicit release', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const base = createMemoryDurableStore({ now: scheduler.now })
  const acquisitionStarted = deferred()
  const finishAcquisition = deferred()
  let pauseReopen = false
  const store = {
    ...base,
    async acquire(key, ownerId, options) {
      if (pauseReopen) {
        acquisitionStarted.resolve()
        await finishAcquisition.promise
      }
      return base.acquire(key, ownerId, options)
    },
  } satisfies DurableStore
  const durable = setup(store, scheduler)
  const created = await durable.create('order-6', { order: 'F-6' })
  if (!created.ok) throw new Error(created.code)
  const started = await created.host.dispatch({ type: 'start' }, { commandId: 'start-6' })
  await created.host.send('paid', { amount: 6 }, { eventId: 'payment-6' })
  await created.host.run.awaitResult()
  await flushRelease(scheduler)

  pauseReopen = true
  const replay = created.host.dispatch({ type: 'start' }, { commandId: 'start-6' })
  await acquisitionStarted.promise
  const released = created.host.release()
  finishAcquisition.resolve()
  await expect(replay).resolves.toEqual({ ...started, status: 'replayed' })
  await expect(released).resolves.toEqual({ ok: true })
  const acquired = await base.acquire('order-6', 'probe')
  expect(acquired.ok).toBe(true)
  if (acquired.ok) await base.release(acquired.lease)
  await expect(
    created.host.send('paid', { amount: 6 }, { eventId: 'payment-6' }),
  ).resolves.toMatchObject({ ok: false, code: 'LEASE_LOST' })
  await durable.dispose()
})

it('merges provided dependencies with the remaining dependencies supplied for each key', async () => {
  const wizard = defineWizard(
    {
      name: 'durable-provided-deps',
      context: boundary.trusted<{ readonly amount: number }>(),
      deps: boundary.trusted<{ readonly currency: string; readonly region: string }>(),
    },
    ({ step, steps }) =>
      steps({
        quote: step({
          run: ({ context, deps }) => `${context.amount} ${deps.currency} in ${deps.region}`,
        }),
      }),
  ).provide({ currency: 'EUR' })
  const scheduler = createTestScheduler({ now: 0 })
  const durable = createDurableHost(wizard, {
    store: createMemoryDurableStore({ now: scheduler.now }),
    scheduler,
    renew: 'manual',
    deps: (key) => ({ region: key.startsWith('eu/') ? 'eu-west' : 'us-east' }),
  })
  const created = await durable.create('eu/quote', { amount: 10 })
  if (!created.ok) throw new Error(created.code)
  await created.host.dispatch({ type: 'start' }, { commandId: 'start-quote' })
  const result = await created.host.run.awaitResult()
  expect(result).toMatchObject({ status: 'done', output: '10 EUR in eu-west' })
  await durable.dispose()
})
