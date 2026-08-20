import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** Services shared by the parent and child flows. */
export interface Deps {
  payments: { charge(orderId: string, amount: number): { chargeId: string } }
  carrier: { ship(orderId: string, warehouse: 'east' | 'west'): Promise<{ tracking: string }> }
}

const fulfilment = defineFlow({
  name: 'fulfilment',
  // The parent supplies `orderId`; the boundary fills the default warehouse.
  context: z.object({
    orderId: z.string(),
    warehouse: z.enum(['east', 'west']).default('east'),
    tracking: z.string().optional(),
  }),
  deps: boundary.trusted<Deps>(), // same Deps: the parent's deps are handed down unchanged
})

export const fulfilmentFlow = fulfilment.steps(
  {
    pick: fulfilment.view({
      input: z.object({ warehouse: z.enum(['east', 'west']) }),
      exit: ({ output, update }) => update({ warehouse: output.warehouse }),
      next: 'ship',
    }),
    ship: fulfilment.task(
      async ({ context, deps, update }) => {
        const { tracking } = await deps.carrier.ship(context.orderId, context.warehouse)
        update({ tracking }) // the typed hand-off to the final step
        return { tracking }
      },
      { next: 'shipped' },
    ),
    // The child's output (`FlowOutput<typeof fulfilment>`) becomes the parent flow step's output.
    shipped: fulfilment.final({ output: ({ context }) => ({ tracking: context.tracking }) }),
  },
  { start: 'pick' },
)

const order = defineFlow({
  name: 'order',
  context: z.object({
    orderId: z.string(),
    amount: z.number().positive(),
    tracking: z.string().optional(),
  }),
  deps: boundary.trusted<Deps>(),
})

export const orderFlow = order.steps(
  {
    pay: order.task(({ context, deps }) => deps.payments.charge(context.orderId, context.amount), {
      next: 'fulfil',
    }),
    // The child has its own run and snapshot. Its events use `path: ['fulfil']`.
    fulfil: order.flow(fulfilmentFlow, {
      context: ({ context }) => ({ orderId: context.orderId }),
      // `output` here is the child's typed output.
      exit: ({ output, update }) => update({ tracking: output.tracking }),
      next: 'receipt',
    }),
    receipt: order.final({
      output: ({ context }) => ({ orderId: context.orderId, tracking: context.tracking }),
    }),
  },
  { start: 'pay' },
)
