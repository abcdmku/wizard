import { z } from 'zod'
import { order } from './order-definition'

export const orderFlow = order.steps({
  address: order.view({
    input: z.object({ city: z.string().min(1) }),
    exit: ({ output, update }) => update(output),
    next: 'prepare',
  }),
  prepare: order.task(({ context, deps }) => deps.inventory.reserve(context.orderId), {
    next: 'route',
  }),
  route: order.decision({
    next: ({ context }) => (context.total > 1_000 ? 'review' : 'done'),
  }),
  review: order.view({ next: 'done' }),
  done: order.final({ output: ({ context }) => ({ orderId: context.orderId }) }),
})
