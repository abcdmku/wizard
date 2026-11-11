import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

/** Services shared by the parent and child wizards. */
export interface Deps {
  payments: { charge(orderId: string, amount: number): { chargeId: string } }
  carrier: { ship(orderId: string, warehouse: 'east' | 'west'): Promise<{ tracking: string }> }
}

export const fulfilmentFlow = defineWizard(
  {
    name: 'fulfilment',
    output: ({ context }) => ({ tracking: context.tracking }),
    // The parent supplies orderId; the child's boundary fills the default warehouse.
    context: z.object({
      orderId: z.string(),
      warehouse: z.enum(['east', 'west']).default('east'),
      tracking: z.string().optional(),
    }),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, view, steps }) =>
    steps(
      {
        pick: view({
          input: z.object({ warehouse: z.enum(['east', 'west']) }),
          exit: ({ output, update }) => update({ warehouse: output.warehouse }),
          next: 'ship',
        }),
        ship: step({
          run: async ({ context, deps, update }) => {
            const { tracking } = await deps.carrier.ship(context.orderId, context.warehouse)
            update({ tracking })
            return { tracking }
          },
        }),
      },
      { start: 'pick' },
    ),
)

export const orderFlow = defineWizard(
  {
    name: 'order',
    context: z.object({
      orderId: z.string(),
      amount: z.number().positive(),
      tracking: z.string().optional(),
    }),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, flow, steps }) =>
    steps(
      {
        pay: step({
          run: ({ context, deps }) => deps.payments.charge(context.orderId, context.amount),
          next: 'fulfil',
        }),
        // Matching dependency types let the child reuse the parent's services.
        // Parent observers see child events at path ['fulfil']; child observers see path [].
        fulfil: flow(fulfilmentFlow, {
          context: ({ context }) => ({ orderId: context.orderId }),
          exit: ({ output, update }) => update({ tracking: output.tracking }),
          next: 'receipt',
        }),
        receipt: step({
          run: ({ context }) => ({ orderId: context.orderId, tracking: context.tracking }),
        }),
      },
      { start: 'pay' },
    ),
)
