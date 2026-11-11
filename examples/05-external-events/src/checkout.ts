import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    description: 'Waits for the payment provider to capture or decline the payment for an order.',
    context: z.object({ orderId: z.string() }),
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
  ({ step, view, steps }) => {
    // This view lets the demo send payment before the wait step starts.
    const review = view({ input: z.object({}), initial: {}, next: 'awaitPayment' })
    const awaitPayment = step({
      description: 'Waits for the provider. Its output is the payload of whichever event arrived.',
      waitFor: {
        'payment.captured': ({ payload }) => ({ done: payload }),
        'payment.failed': ({ payload }) => ({ done: payload }),
      },
      timeout: { after: '30m', next: 'expired' },
      // Wait handlers complete the wait. This declared route selects the next step.
      targets: ['paid', 'declined'],
      next: ({ output }) => ('reason' in output ? 'declined' : 'paid'),
    })
    // Both endings need the wait. Its output is one of two payloads, so each ending narrows it.
    const paid = step({
      needs: { payment: awaitPayment },
      run: ({ needs }) =>
        'paymentId' in needs.payment ? `paid (${needs.payment.paymentId})` : 'paid',
    })
    const declined = step({
      needs: { payment: awaitPayment },
      run: ({ needs }) =>
        'reason' in needs.payment ? `declined: ${needs.payment.reason}` : 'declined',
    })
    const expired = step({
      description: 'Ends the run when no payment event arrived in time.',
      run: () => 'expired: no payment within 30 minutes',
    })
    return steps({ review, awaitPayment, paid, declined, expired }, { start: 'review' })
  },
)
