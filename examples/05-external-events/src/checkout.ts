import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const checkoutFlow = defineWizard(
  {
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
  },
  ({ step, view, steps }) =>
    steps(
      {
        // This view lets the demo send payment before the wait step starts.
        review: view({ input: z.object({}), initial: {}, next: 'awaitPayment' }),
        awaitPayment: step({
          waitFor: {
            'payment.captured': ({ payload, update }) => {
              update({ paymentId: payload.paymentId })
              return { done: payload }
            },
            'payment.failed': ({ payload, update }) => {
              update({ declineReason: payload.reason })
              return { done: payload }
            },
          },
          timeout: { after: '30m', next: 'expired' },
          // Wait handlers complete the wait. This declared route selects the next step.
          targets: ['paid', 'declined'],
          next: ({ context }) => (context.declineReason === undefined ? 'paid' : 'declined'),
        }),
        paid: step({ run: ({ context }) => `paid (${context.paymentId})` }),
        declined: step({ run: ({ context }) => `declined: ${context.declineReason}` }),
        expired: step({ run: () => 'expired: no payment within 30 minutes' }),
      },
      { start: 'review' },
    ),
)
