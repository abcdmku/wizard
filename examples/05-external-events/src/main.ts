/**
 * Runnable walk-through: `pnpm --filter example-05-external-events start`.
 * A webhook arrives with a bad body (rejected), then a good one arrives EARLY (buffered), and is
 * delivered the moment the wait step enters.
 */
import { createWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { checkout } from './checkout'

const sched = createTestScheduler({ now: 0 })
const wizard = createWizard(checkout, { context: { orderId: 'o-1' }, scheduler: sched })
wizard.observe((event) => {
  if (event.type.startsWith('event.') || event.type === 'step.done' || event.type === 'flow.done')
    console.log(
      `t=${sched.now()}  ${event.type}${'step' in event ? ` ${event.step}` : ''}${'event' in event ? ` (${event.event})` : ''}`,
    )
})

await wizard.start()
console.log('current view:', wizard.getState().current)

const bad = await wizard.send('payment.captured', { paymentId: 42 })
console.log('send(bad body) →', JSON.stringify(bad))

const early = await wizard.send('payment.captured', { paymentId: 'pay_1', amount: 42 })
console.log('send(good body, nobody listening yet) →', JSON.stringify(early))
console.log('inbox size:', wizard.getState().inbox.length)

sched.advance(2 * 60_000)
await wizard.next() // the wait step enters and drains the inbox
console.log('status:', wizard.getState().status, '| output:', wizard.getState().output)
wizard.dispose()
