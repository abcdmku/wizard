import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface TripDeps {
  flights: {
    book(tripId: string): Promise<{ ref: string }>
    cancel(ref: string, options: { idempotencyKey: string }): Promise<void>
  }
  hotels: { book(tripId: string): Promise<{ ref: string }> }
}

export const trip = defineWizard(
  {
    name: 'trip',
    context: z.object({ tripId: z.string() }),
    deps: boundary.trusted<TripDeps>(),
    onFailure: 'compensate',
  },
  ({ step, steps }) =>
    steps({
      flight: step({
        run: ({ context, deps }) => deps.flights.book(context.tripId),
        compensate: ({ output, deps, idempotencyKey }) =>
          deps.flights.cancel(output.ref, { idempotencyKey }),
        next: 'hotel',
      }),
      hotel: step({ run: ({ context, deps }) => deps.hotels.book(context.tripId) }),
    }),
)
