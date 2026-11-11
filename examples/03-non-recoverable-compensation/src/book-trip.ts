import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  flights: { reserve(trip: string): { pnr: string }; cancel(pnr: string): void }
  hotels: { reserve(trip: string): { booking: string }; cancel(booking: string): void }
  cars: { reserve(trip: string): { rental: string }; cancel(rental: string): void }
  payments: { charge(trip: string, amount: number): { receipt: string } }
}

export const bookTrip = defineWizard(
  {
    name: 'book-trip',
    description: 'Reserves a flight, a hotel and a car, then charges. A failure undoes them.',
    context: z.object({ tripId: z.string(), total: z.number().positive() }),
    deps: boundary.trusted<Deps>(),
    // A terminal task failure compensates completed steps in reverse completion order.
    onFailure: 'compensate',
  },
  ({ step, steps }) =>
    steps(
      {
        reserveFlight: step({
          run: ({ context, deps }) => deps.flights.reserve(context.tripId),
          // `output` is this step's own result, inferred from `run`.
          compensate: ({ output, deps }) => deps.flights.cancel(output.pnr),
          next: 'reserveHotel',
        }),
        reserveHotel: step({
          run: ({ context, deps }) => deps.hotels.reserve(context.tripId),
          compensate: ({ output, deps }) => deps.hotels.cancel(output.booking),
          next: 'reserveCar',
        }),
        reserveCar: step({
          run: ({ context, deps }) => deps.cars.reserve(context.tripId),
          compensate: ({ output, deps }) => deps.cars.cancel(output.rental),
          next: 'charge',
        }),
        // A failed charge has nothing to undo. It triggers the reservations' unwind.
        charge: step({
          run: ({ context, deps }) => deps.payments.charge(context.tripId, context.total),
          next: 'confirmed',
        }),
        confirmed: step({ run: ({ context }) => `trip ${context.tripId} booked` }),
      },
      { start: 'reserveFlight' },
    ),
)
