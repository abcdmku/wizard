import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const checkout = defineFlow({
  name: 'checkout',
  context: z.object({
    orderId: z.string(),
    paymentId: z.string().optional(),
    declineReason: z.string().optional(),
  }),
  // Every input-event payload passes through its boundary before a handler sees it.
  events: {
    'payment.captured': z.object({
      paymentId: z.string(),
      amount: z.number().positive(),
      orderId: z.string().optional(), // the provider echoes our order id
    }),
    'payment.failed': z.object({ reason: z.string() }),
    'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
  },
  // Flow-level handlers run after step handlers, regardless of which step is active.
  on: {
    'order.cancelled': ({ payload }) => ({ cancel: payload.reason }),
  },
  // An event for another correlation id is dropped instead of buffered.
  correlate: {
    'payment.captured': (payload) => payload.orderId,
    'order.cancelled': (payload) => payload.orderId,
  },
  // Unmatched events wait in a FIFO inbox for up to ten minutes.
  unmatchedEvents: { buffer: true, ttl: '10m' },
})

export const checkoutFlow = checkout.steps(
  {
    // This view lets the demo send payment before the wait step starts.
    review: checkout.view({ next: 'awaitPayment' }),
    awaitPayment: checkout.wait({
      on: {
        // `update` copies the parsed payload into context.
        'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
        // A handler may override the step's static `next`.
        'payment.failed': ({ payload, update }) => {
          update({ declineReason: payload.reason })
          return { next: 'declined' }
        },
      },
      timeout: { after: '30m', next: 'expired' },
      next: 'paid',
    }),
    paid: checkout.final({ output: ({ context }) => `paid (${context.paymentId})` }),
    declined: checkout.final({ output: ({ context }) => `declined: ${context.declineReason}` }),
    expired: checkout.final({ output: () => 'expired: no payment within 30 minutes' }),
  },
  { start: 'review' },
)
