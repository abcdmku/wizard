import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** Three suppliers with a reserve/cancel pair each, and a payment provider. */
export interface Deps {
  flights: { reserve(trip: string): { pnr: string }; cancel(pnr: string): void }
  hotels: { reserve(trip: string): { booking: string }; cancel(booking: string): void }
  cars: { reserve(trip: string): { rental: string }; cancel(rental: string): void }
  payments: { charge(trip: string, amount: number): { receipt: string } }
}

const s = defineFlow({
  name: 'book-trip',
  context: z.object({ tripId: z.string(), total: z.number().positive() }),
  deps: boundary.trusted<Deps>(), // built by the host, no runtime check
  // A task failing with no retries left (or `cancel()`) unwinds every completed step that
  // declared a `compensate` hook, in reverse completion order — best effort, one at a time.
  onFailure: 'compensate',
})

export const bookTrip = s.steps(
  {
    reserveFlight: s.task(({ context, deps }) => deps.flights.reserve(context.tripId), {
      // `output` is this task's own result, typed from `run`.
      compensate: ({ output, deps }) => deps.flights.cancel(output.pnr),
      next: 'reserveHotel',
    }),
    reserveHotel: s.task(({ context, deps }) => deps.hotels.reserve(context.tripId), {
      compensate: ({ output, deps }) => deps.hotels.cancel(output.booking),
      next: 'reserveCar',
    }),
    reserveCar: s.task(({ context, deps }) => deps.cars.reserve(context.tripId), {
      compensate: ({ output, deps }) => deps.cars.cancel(output.rental),
      next: 'charge',
    }),
    // No `compensate` here: a failed charge has nothing to undo — it is what triggers the unwind.
    charge: s.task(({ context, deps }) => deps.payments.charge(context.tripId, context.total), {
      next: 'confirmed',
    }),
    confirmed: s.final({ output: ({ context }) => `trip ${context.tripId} booked` }),
  },
  { start: 'reserveFlight' },
)
