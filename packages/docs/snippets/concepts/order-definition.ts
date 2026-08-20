import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  inventory: {
    reserve(
      orderId: string,
      options?: { idempotencyKey: string },
    ): Promise<{ reservationId: string }>
    release(reservationId: string): Promise<void>
  }
}

export const order = defineFlow({
  name: 'order',
  version: 1,
  context: z.object({
    orderId: z.string(),
    total: z.number().positive(),
    city: z.string().optional(),
  }),
  deps: boundary.trusted<Deps>(),
})

export const orderFlow = order.steps({
  reserve: order.task(({ context, deps }) => deps.inventory.reserve(context.orderId), {
    next: 'done',
  }),
  done: order.final({ output: ({ context }) => ({ orderId: context.orderId }) }),
})
