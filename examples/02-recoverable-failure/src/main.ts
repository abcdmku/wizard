/**
 * Runnable walk-through: `pnpm --filter example-02-recoverable-failure start`.
 * A flaky ledger fails twice; the retry policy waits 200 ms, then 400 ms (virtual time — the
 * test scheduler doubles as the clock, so the demo finishes instantly).
 */
import { createWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { type Deps, syncInvoice } from './sync-invoice'

let calls = 0
const deps: Deps = {
  ledger: {
    post: async (invoiceId) => {
      calls += 1
      if (calls <= 2) throw new Error(`ledger unavailable (call ${calls})`)
      return { ref: `L-${invoiceId}` }
    },
  },
}

const sched = createTestScheduler({ now: 0 })
const wizard = createWizard(syncInvoice, {
  context: { invoiceId: 'INV-7', amount: 120 },
  deps,
  scheduler: sched,
})
wizard.observe((event) => {
  if (event.type === 'step.runFailed')
    console.log(
      `t=${sched.now()}  attempt ${event.attempt} failed: ${event.error.message}${event.willRetry ? ' → will retry' : ''}`,
    )
  if (event.type === 'step.retryScheduled')
    console.log(`t=${sched.now()}  retry #${event.attempt} scheduled for t=${event.dueAt}`)
  if (event.type === 'step.runSucceeded')
    console.log(
      `t=${sched.now()}  attempt ${event.attempt} succeeded: ${JSON.stringify(event.output)}`,
    )
})

const settle = () => new Promise<void>((r) => setTimeout(r, 0))
await wizard.start()
await settle()
while (sched.pending() > 0) {
  console.log(`         explain(post): ${wizard.explain('post').reasons.join(', ')}`)
  sched.flush() // jump to the next due timer
  await settle()
}
console.log('status:', wizard.getState().status, '| output:', wizard.getState().output)
wizard.dispose()
