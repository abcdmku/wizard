import { createRun, defineFlow } from '@openwizard/core'
import { defineWebhook } from '@openwizard/webhooks'
import { z } from 'zod'

const delivery = defineFlow({
  name: 'delivery',
  context: z.object({ packageId: z.string() }),
  events: {
    delivered: z.object({ signedBy: z.string() }),
  },
})

const deliveryFlow = delivery.steps({
  wait: delivery.wait({ on: { delivered: () => undefined }, next: 'done' }),
  done: delivery.final(),
})

const run = createRun(deliveryFlow, { context: { packageId: 'pkg-1' } })

export const deliveredWebhook = defineWebhook({
  flow: deliveryFlow,
  event: 'delivered',
  secret: 'whsec_replace_me',
  resolveRun: () => run,
})
