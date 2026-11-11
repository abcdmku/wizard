/**
 * Runnable walk-through: `pnpm --filter example-11-order-workflow start`.
 * An order reserves inventory, charges the customer, requests fulfilment, then receives the
 * typed `shipment.ready` webhook. The scheduler is virtual so this demo never waits 24 hours.
 */
import { createMemoryStore, type Run } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { type Deps, orderWorkflowFlow } from './order-workflow'

const orderId = 'o-42'
const key = `tenant-a/orders/${orderId}`
const store = createMemoryStore()
const scheduler = createTestScheduler({ now: 0 })
const calls: string[] = []

const deps: Deps = {
  inventory: {
    reserve: async (id, _lines, { idempotencyKey }) => {
      calls.push(`inventory.reserve(${id}, ${idempotencyKey})`)
      return { reservationId: `reservation-${id}` }
    },
    release: async (reservationId, { idempotencyKey }) => {
      calls.push(`inventory.release(${reservationId}, ${idempotencyKey})`)
    },
  },
  payments: {
    charge: async (id, amount, { idempotencyKey }) => {
      calls.push(`payments.charge(${id}, ${amount}, ${idempotencyKey})`)
      return { paymentId: `payment-${id}` }
    },
    refund: async (paymentId, { idempotencyKey }) => {
      calls.push(`payments.refund(${paymentId}, ${idempotencyKey})`)
    },
  },
  fulfilment: {
    request: async (id, { idempotencyKey }) => {
      calls.push(`fulfilment.request(${id}, ${idempotencyKey})`)
      return { requestId: `fulfilment-${id}` }
    },
  },
}

const run: Run<typeof orderWorkflowFlow> = orderWorkflowFlow.create(
  {
    orderId,
    lines: [{ sku: 'book-1', quantity: 2 }],
    total: 42,
  },
  {
    deps,
    instanceId: `order-${orderId}`,
    correlationId: orderId,
    store,
    key,
    scheduler,
  },
)

run.observe((event) => {
  if (event.type === 'step.runStarted')
    console.log(`t=${scheduler.now()}  ${event.step} started (attempt ${event.attempt})`)
  if (event.type === 'step.retryScheduled')
    console.log(`t=${scheduler.now()}  ${event.step} retry #${event.attempt} at t=${event.dueAt}`)
  if (event.type === 'event.received' || event.type === 'event.delivered')
    console.log(`t=${scheduler.now()}  ${event.type} ${event.event}`)
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
await run.start()
await settle()
console.log('waiting for shipment:', run.getState().status, '| calls:', calls)

await run.send('shipment.ready', {
  orderId,
  shipmentId: 'ship-42',
  trackingUrl: 'https://carrier.example/track/ship-42',
})
await run.save()
const snapshot = run.getSnapshot()
console.log('status:', run.getState().status, '| output:', run.getState().output)
console.log('snapshot:', snapshot.flow, '| key:', key, '| stored keys:', store.keys())
run.dispose()
