/**
 * Runnable walk-through: `pnpm --filter example-03-non-recoverable-compensation start`.
 * Three reservations succeed, the payment is declined, and the saga unwinds in reverse order.
 */
import { createWizard } from '@openwizard/core'
import { bookTrip, type Deps } from './book-trip'

const deps: Deps = {
  flights: {
    reserve: (t) => ({ pnr: `PNR-${t}` }),
    cancel: (pnr) => console.log(`  ↩ flights.cancel(${pnr})`),
  },
  hotels: {
    reserve: (t) => ({ booking: `H-${t}` }),
    cancel: (b) => console.log(`  ↩ hotels.cancel(${b})`),
  },
  cars: {
    reserve: (t) => ({ rental: `CAR-${t}` }),
    cancel: (r) => console.log(`  ↩ cars.cancel(${r})`),
  },
  payments: {
    charge: () => {
      throw new Error('card declined')
    },
  },
}

const wizard = createWizard(bookTrip, { context: { tripId: 'T1', total: 900 }, deps })
wizard.observe((event) => {
  switch (event.type) {
    case 'step.done':
      console.log(`✔ ${event.step} → ${JSON.stringify(event.output)}`)
      break
    case 'step.failed':
      console.log(`✖ ${event.step} failed (${event.kind}): ${event.error.message}`)
      break
    case 'flow.compensating':
      console.log(`⟲ compensating, plan: ${event.plan.join(' → ')}`)
      break
    case 'flow.compensated':
      console.log(`⟲ compensated (outcome ${event.outcome}, failures: ${event.failures.length})`)
      break
    default:
  }
})

await wizard.start()
const state = wizard.getState()
console.log('status:', state.status)
console.log('saga.compensated:', state.saga.compensated.map((e) => e.step).join(', '))
wizard.dispose()
