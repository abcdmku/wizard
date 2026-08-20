/**
 * Runnable walk-through: `pnpm --filter example-03-non-recoverable-compensation start`.
 * Three reservations succeed, the payment is declined, and the saga unwinds in reverse order.
 */
import { createRun } from '@openwizard/core'
import { bookTripFlow, type Deps } from './book-trip'

const deps: Deps = {
  flights: {
    reserve: (tripId) => ({ pnr: `PNR-${tripId}` }),
    cancel: (pnr) => console.log(`  ↩ flights.cancel(${pnr})`),
  },
  hotels: {
    reserve: (tripId) => ({ booking: `H-${tripId}` }),
    cancel: (booking) => console.log(`  ↩ hotels.cancel(${booking})`),
  },
  cars: {
    reserve: (tripId) => ({ rental: `CAR-${tripId}` }),
    cancel: (rental) => console.log(`  ↩ cars.cancel(${rental})`),
  },
  payments: {
    charge: () => {
      throw new Error('card declined')
    },
  },
}

const run = createRun(bookTripFlow, { context: { tripId: 'T1', total: 900 }, deps })
run.observe((event) => {
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

await run.start()
const state = run.getState()
console.log('status:', state.status)
console.log('saga.compensated:', state.saga.compensated.map((entry) => entry.step).join(', '))
run.dispose()
