import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const delivery = defineFlow({
  name: 'delivery',
  context: z.object({ speed: z.enum(['standard', 'express']) }),
})

export const deliveryFlow = delivery.steps({
  choose: delivery.decision({
    next: ({ context }) => (context.speed === 'express' ? 'express' : 'standard'),
  }),
  standard: delivery.task(async () => '3 to 5 days', { next: 'done' }),
  express: delivery.task(async () => 'next day', { next: 'done' }),
  done: delivery.final(),
})
