import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

/** What the payment provider reported. */
type Payment =
  | { readonly status: 'captured'; readonly paymentId: string }
  | { readonly status: 'failed'; readonly reason: string }
/** The provider reported nothing in time. */
type Expired = { readonly status: 'expired' }

export const checkout = defineWizard(
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
    // Wizard-level handlers run after step handlers, regardless of which step is active.
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
      description: 'Waits for the provider. Either event completes the wait with a payment.',
      waitFor: {
        'payment.captured': ({ payload }): { done: Payment } => ({
          done: { status: 'captured', paymentId: payload.paymentId },
        }),
        'payment.failed': ({ payload }): { done: Payment } => ({
          done: { status: 'failed', reason: payload.reason },
        }),
      },
      timeout: { after: '30m', next: 'expired' },
    })
    // A wait that times out is skipped and has no output, so the timeout path has its own step.
    const expired = step({
      description: 'Records that no payment event arrived in time.',
      run: (): Expired => ({ status: 'expired' }),
    })
    // Exactly one of the two finishes. The need is typed as the union of their outputs, and the
    // `string` return type makes a missing case a compile error.
    const result = step({
      description: 'Turns the outcome into the result of the checkout.',
      needs: { outcome: { any: [awaitPayment, expired] } },
      run: ({ needs }): string => {
        switch (needs.outcome.status) {
          case 'captured':
            return `paid (${needs.outcome.paymentId})`
          case 'failed':
            return `declined: ${needs.outcome.reason}`
          case 'expired':
            return 'expired: no payment within 30 minutes'
        }
      },
    })
    return steps({ review, awaitPayment, expired, result }, { start: 'review' })
  },
)
