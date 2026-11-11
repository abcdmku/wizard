/**
 * Runnable walk-through: `pnpm --filter example-02-recoverable-failure start`.
 * A flaky ledger fails twice; the retry policy waits 200 ms, then 400 ms. The time is virtual
 * (the test scheduler doubles as the clock), so the demo finishes instantly.
 */
import { createTestScheduler } from '@openwizard/core/testing'
import { type Deps, syncInvoice } from './sync-invoice'

let calls = 0
const deps: Deps = {
  ledger: {
    post: async (invoiceId, _amount, { idempotencyKey }) => {
      calls += 1
      console.log(`         ledger.post(${invoiceId}) with idempotency key ${idempotencyKey}`)
      if (calls <= 2) throw new Error(`ledger unavailable (call ${calls})`)
      return { ref: `L-${invoiceId}` }
    },
  },
}

const scheduler = createTestScheduler({ now: 0 })
const run = syncInvoice.create({ invoiceId: 'INV-7', amount: 120 }, { deps, scheduler })
run.observe((event) => {
  if (event.type === 'step.runFailed')
    console.log(
      `t=${scheduler.now()}  attempt ${event.attempt} failed: ${event.error.message}${event.willRetry ? ' → will retry' : ''}`,
    )
  if (event.type === 'step.retryScheduled')
    console.log(`t=${scheduler.now()}  retry #${event.attempt} scheduled for t=${event.dueAt}`)
  if (event.type === 'step.runSucceeded')
    console.log(
      `t=${scheduler.now()}  attempt ${event.attempt} succeeded: ${JSON.stringify(event.output)}`,
    )
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
await run.start()
await settle()
while (scheduler.pending() > 0) {
  console.log(`         explain(post): ${run.explain('post').reasons.join(', ')}`)
  scheduler.flush() // jump to the next due timer
  await settle()
}
console.log('status:', run.getState().status, '| output:', run.getState().output)
run.dispose()
