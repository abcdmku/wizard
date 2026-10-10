import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const s = defineFlow({
  name: 'checkout',
  context: z.object({
    orderId: z.string(),
    paymentId: z.string().optional(),
    declineReason: z.string().optional(),
  }),
  // Webhook bodies are untrusted: every `send()` goes through the event's boundary first.
  events: {
    'payment.captured': z.object({
      paymentId: z.string(),
      amount: z.number().positive(),
      orderId: z.string().optional(), // the provider echoes our order id
    }),
    'payment.failed': z.object({ reason: z.string() }),
    'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
  },
  // Flow-level handlers run for an event whatever step is active (after the step-level ones):
  // a cancellation is a flow-wide concern, so it lives here — `{ cancel }` cancels the flow.
  on: {
    'order.cancelled': ({ payload }) => ({ cancel: payload.reason }),
  },
  // Correlation: with `createWizard(checkout, { correlationId })`, an event whose extracted id
  // differs is dropped (`event.dropped { reason: 'correlation' }`) — a webhook for another order
  // never lands here. Payloads without an id (undefined) are not filtered.
  correlate: {
    'payment.captured': (payload) => payload.orderId,
    'order.cancelled': (payload) => payload.orderId,
  },
  // An event with no active listener is buffered (FIFO) for 10 minutes and delivered when a
  // wait step that handles it enters — the "webhook arrives before we listen" race.
  unmatchedEvents: { buffer: true, ttl: '10m' },
})

export const checkout = s.steps(
  {
    // A view first, so the demo can send events BEFORE the wait step is active.
    review: s.view({ next: 'awaitPayment' }),
    awaitPayment: s.wait({
      on: {
        // Handlers see the PARSED payload; `update` writes into the typed context.
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
    paid: s.final({ output: ({ context }) => `paid (${context.paymentId})` }),
    declined: s.final({ output: ({ context }) => `declined: ${context.declineReason}` }),
    expired: s.final({ output: () => 'expired: no payment within 30 minutes' }),
  },
  { start: 'review' },
)
