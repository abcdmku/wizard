import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const fulfilment = defineFlow({
  name: 'fulfilment',
  context: z.object({ orderId: z.string(), tracking: z.string().optional() }),
})

const fulfilmentFlow = fulfilment.steps({
  pack: fulfilment.task(() => ({ tracking: 'trk-9' }), {
    exit: ({ output, update }) => update(output),
    next: 'done',
  }),
  done: fulfilment.final({ output: ({ context }) => ({ tracking: context.tracking }) }),
})

const order = defineFlow({
  name: 'order',
  context: z.object({ orderId: z.string(), tracking: z.string().optional() }),
})

export const orderFlow = order.steps({
  fulfil: order.flow(fulfilmentFlow, {
    context: ({ context }) => ({ orderId: context.orderId }),
    exit: ({ output, update }) => update(output),
    next: 'done',
  }),
  done: order.final({ output: ({ context }) => ({ tracking: context.tracking }) }),
})
