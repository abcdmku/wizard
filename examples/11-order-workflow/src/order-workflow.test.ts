import { createMemoryStore, type RunEvent } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { type Deps, orderWorkflowFlow } from './order-workflow'

const T0 = 1_000_000
const KEY = 'tenant-a/orders/o-42'
const context = {
  orderId: 'o-42',
  lines: [{ sku: 'book-1', quantity: 2 }],
  total: 42,
}
const ready = {
  orderId: 'o-42',
  shipmentId: 'ship-42',
  trackingUrl: 'https://carrier.example/track/ship-42',
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Failures = { chargeFailures?: number; requestFails?: boolean; chargeMessage?: string }

function fakeDeps(options: Failures = {}) {
  const calls: string[] = []
  const keys = { reserve: [] as string[], charge: [] as string[], request: [] as string[] }
  let chargeCalls = 0
  const deps: Deps = {
    inventory: {
      reserve: async (_orderId, _lines, { idempotencyKey }) => {
        calls.push('inventory.reserve')
        keys.reserve.push(idempotencyKey)
        return { reservationId: 'reservation-42' }
      },
      release: async (reservationId, { idempotencyKey }) => {
        calls.push(`inventory.release:${reservationId}:${idempotencyKey}`)
      },
    },
    payments: {
      charge: async (_orderId, _amount, { idempotencyKey }) => {
        calls.push('payments.charge')
        keys.charge.push(idempotencyKey)
        chargeCalls += 1
        if (chargeCalls <= (options.chargeFailures ?? 0))
          throw new Error(options.chargeMessage ?? `payment unavailable (attempt ${chargeCalls})`)
        return { paymentId: 'payment-42' }
      },
      refund: async (paymentId, { idempotencyKey }) => {
        calls.push(`payments.refund:${paymentId}:${idempotencyKey}`)
      },
    },
    fulfilment: {
      request: async (_orderId, { idempotencyKey }) => {
        calls.push('fulfilment.request')
        keys.request.push(idempotencyKey)
        if (options.requestFails) throw new Error('fulfilment unavailable')
        return { requestId: 'fulfilment-42' }
      },
    },
  }
  return { deps, calls, keys }
}

function make(options: Failures = {}) {
  const scheduler = createTestScheduler({ now: T0 })
  const store = createMemoryStore()
  const { deps, calls, keys } = fakeDeps(options)
  const run = orderWorkflowFlow.create(context, {
    deps,
    instanceId: 'order-o-42',
    correlationId: context.orderId,
    store,
    key: KEY,
    scheduler: scheduler,
  })
  const events: RunEvent<typeof orderWorkflowFlow>[] = []
  run.observe((event) => events.push(event))
  const eventsOfType = <T extends RunEvent<typeof orderWorkflowFlow>['type']>(type: T) =>
    events.filter(
      (event): event is Extract<RunEvent<typeof orderWorkflowFlow>, { type: T }> =>
        event.type === type,
    )
  return { run, scheduler, store, calls, keys, events, eventsOfType }
}

describe('11 order workflow: tasks, durable retry, event wait, persistence and compensation', () => {
  it('reserves, charges, waits for a typed shipment event, and persists the final snapshot', async () => {
    const { run, store, calls } = make()

    await run.start()
    await settle() // async service calls settle and the wait step becomes active
    expect(run.getState().status).toBe('waiting')
    expect(run.getState().active).toEqual(['awaitShipment'])
    expect(calls).toEqual(['inventory.reserve', 'payments.charge', 'fulfilment.request'])

    const foreign = await run.send('shipment.ready', { ...ready, orderId: 'o-other' })
    expect(foreign).toMatchObject({ ok: false, reason: 'dropped' })
    expect(run.getState().steps.awaitShipment.status).toBe('active')

    const delivered = await run.send('shipment.ready', ready)
    expect(delivered).toMatchObject({ ok: true, delivered: ['awaitShipment'] })
    expect(run.getState().steps.awaitShipment.output).toMatchObject({ shipmentId: 'ship-42' })
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe(
      'order o-42 shipped (ship-42; https://carrier.example/track/ship-42)',
    )

    await run.save()
    const saved = await store.get(KEY)
    expect(saved).toMatchObject({
      v: 1,
      flow: { name: 'order-workflow', version: 1 },
      instanceId: 'order-o-42',
      state: { status: 'done', output: run.getState().output },
    })
    expect(store.keys()).toEqual([KEY])
    run.dispose()
  })

  it('retries charge at virtual 200 ms and 400 ms deadlines, reusing its idempotency key', async () => {
    const { run, scheduler, keys, eventsOfType } = make({ chargeFailures: 2 })

    await run.start()
    await settle()
    expect(eventsOfType('step.retryScheduled')[0]).toMatchObject({
      step: 'charge',
      attempt: 2,
      dueAt: T0 + 200,
    })
    expect(run.getState().steps.charge).toMatchObject({ status: 'active', retryAt: T0 + 200 })

    scheduler.advance(199)
    expect(keys.charge).toHaveLength(1)
    scheduler.advance(1)
    await settle()
    expect(eventsOfType('step.retryScheduled')[1]).toMatchObject({
      step: 'charge',
      attempt: 3,
      dueAt: T0 + 600,
    })

    scheduler.advance(399)
    expect(keys.charge).toHaveLength(2)
    scheduler.advance(1)
    await settle()
    expect(keys.charge).toHaveLength(3)
    expect(new Set(keys.charge)).toEqual(new Set(['order:o-42:payment-charge']))
    expect(run.getState().steps.charge.status).toBe('done')
    expect(run.getState().status).toBe('waiting') // the successful run is now waiting for shipment
    expect(run.getState().steps.awaitShipment.status).toBe('active')
    run.dispose()
  })

  it('compensates a paid order when fulfilment rejects the request', async () => {
    const { run, calls, eventsOfType } = make({ requestFails: true })

    await run.start()
    await settle()
    expect(run.getState().status).toBe('failed')
    expect(calls).toEqual([
      'inventory.reserve',
      'payments.charge',
      'fulfilment.request',
      'payments.refund:payment-42:order:o-42:payment-refund',
      'inventory.release:reservation-42:order:o-42:inventory-release',
    ])
    expect(eventsOfType('flow.compensating')[0]).toMatchObject({
      plan: ['charge', 'reserve'],
      status: 'failed',
    })
    expect(eventsOfType('flow.compensated')[0]).toMatchObject({ failures: [], status: 'failed' })
    expect(run.getState().steps.charge.status).toBe('compensated')
    expect(run.getState().steps.reserve.status).toBe('compensated')
    run.dispose()
  })

  it('uses the mapped error to stop retrying a declined payment and releases its reservation', async () => {
    const { run, calls, keys, eventsOfType } = make({
      chargeFailures: 1,
      chargeMessage: 'payment declined',
    })
    await run.start()
    await settle()
    expect(run.getState().status).toBe('failed')
    expect(run.getState().steps.charge.error?.data).toEqual({ code: 'DECLINED', attempt: 1 })
    expect(eventsOfType('step.retryScheduled')).toEqual([])
    expect(keys.charge).toEqual(['order:o-42:payment-charge'])
    expect(calls).toEqual([
      'inventory.reserve',
      'payments.charge',
      'inventory.release:reservation-42:order:o-42:inventory-release',
    ])
    run.dispose()
  })
})
