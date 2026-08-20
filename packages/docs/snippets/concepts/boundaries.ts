import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const order = defineFlow({
  name: 'order',
  context: z.object({
    orderId: z.string().trim().min(1),
    total: z.coerce.number().positive(),
  }),
})

const orderFlow = order.steps({ done: order.final() })
const run = createRun(orderFlow, {
  context: { orderId: ' o-42 ', total: '42' },
})

run.getState().context // { orderId: 'o-42', total: 42 }
