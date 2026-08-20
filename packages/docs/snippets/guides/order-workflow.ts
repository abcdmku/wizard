import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const order = defineFlow({
  name: 'order',
  context: z.object({
    orderId: z.string(),
    trackingUrl: z.url().optional(),
  }),
  events: {
    'shipment.ready': z.object({
      orderId: z.string(),
      trackingUrl: z.url(),
    }),
  },
  correlate: {
    'shipment.ready': (payload) => payload.orderId,
  },
})

const orderFlow = order.steps(
  {
    shipment: order.wait({
      on: {
        'shipment.ready': ({ payload, update }) => update({ trackingUrl: payload.trackingUrl }),
      },
      next: 'done',
    }),
    done: order.final({ output: ({ context }) => context.trackingUrl }),
  },
  { start: 'shipment' },
)

const run = createRun(orderFlow, {
  context: { orderId: 'o-42' },
  correlationId: 'o-42',
})

await run.start()
const sent = await run.send('shipment.ready', {
  orderId: 'o-42',
  trackingUrl: 'https://carrier.example/ship-42',
})
if (!sent.ok) throw new Error(sent.message)

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error(result.status)
export const output = result.output
run.dispose()
