/**
 * Runnable walk-through: `pnpm --filter example-05-external-events start`.
 * A webhook arrives with a bad body (rejected), then a good one arrives EARLY (buffered), and is
 * delivered the moment the wait step enters.
 */
import { createTestScheduler } from '@openwizard/core/testing'
import { checkoutFlow } from './checkout'

const scheduler = createTestScheduler({ now: 0 })
const run = checkoutFlow.create(
  { orderId: 'o-1' },
  {
    correlationId: 'o-1', // correlated webhooks for other orders are dropped
    scheduler: scheduler,
  },
)
run.observe((event) => {
  if (event.type.startsWith('event.') || event.type === 'step.done' || event.type === 'flow.done')
    console.log(
      `t=${scheduler.now()}  ${event.type}${'step' in event ? ` ${event.step}` : ''}${'event' in event ? ` (${event.event})` : ''}`,
    )
})

await run.start()
console.log('current view:', run.getState().current)

// A request body is `unknown`: the event's schema parses it at the boundary.
const body: unknown = { paymentId: 42 }
const bad = await run.send('payment.captured', body)
console.log('send(bad body) →', JSON.stringify(bad))

const foreign = await run.send('payment.captured', {
  paymentId: 'pay_7',
  amount: 1,
  orderId: 'o-2',
})
console.log('send(webhook for another order) →', JSON.stringify(foreign))

const early = await run.send('payment.captured', {
  paymentId: 'pay_1',
  amount: 42,
  orderId: 'o-1',
})
console.log('send(good body, nobody listening yet) →', JSON.stringify(early))
console.log('inbox size:', run.getState().inbox.length)

scheduler.advance(2 * 60_000)
await run.next() // the wait step enters and drains the inbox
console.log('status:', run.getState().status, '| output:', run.getState().output)
run.dispose()
