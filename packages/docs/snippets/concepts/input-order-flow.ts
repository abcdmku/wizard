import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const order = defineFlow({
  name: 'order',
  context: z.object({ orderId: z.string(), paymentId: z.string().optional() }),
  events: {
    'payment.captured': z.object({ orderId: z.string(), paymentId: z.string() }),
  },
  correlate: {
    'payment.captured': (payload) => payload.orderId,
  },
})

export const orderFlow = order.steps({
  payment: order.wait({
    on: {
      'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
    },
    timeout: { after: '30m', next: 'expired' },
    next: 'paid',
  }),
  paid: order.final({ output: ({ context }) => ({ paymentId: context.paymentId }) }),
  expired: order.final({ output: () => ({ paymentId: undefined }) }),
})

const run = createRun(orderFlow, {
  context: { orderId: 'o-42' },
  correlationId: 'o-42',
})

await run.start()
await run.send('payment.captured', {
  orderId: 'o-42',
  paymentId: 'p-9',
})
