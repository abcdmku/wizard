import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const orders = defineFlow({
  name: 'orders',
  context: z.object({ orderId: z.string() }),
  events: {
    'review.approved': z.object({ reviewerId: z.string() }),
  },
})

export const orderFlow = orders.steps({
  address: orders.view({
    input: z.object({ street: z.string().min(1) }),
    next: 'charge',
  }),
  charge: orders.task(() => ({ paymentId: 'payment-1' }), { next: 'done' }),
  done: orders.final({
    output: ({ context }) => ({ orderId: context.orderId }),
  }),
})
