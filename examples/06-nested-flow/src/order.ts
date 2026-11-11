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
    description: 'Lets a person pick a warehouse, then ships the order from it.',
    // The parent supplies orderId; the child's boundary fills the default warehouse.
    context: z.object({
      orderId: z.string(),
      warehouse: z.enum(['east', 'west']).default('east'),
    }),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, view, steps }) =>
    steps(
      {
        pick: view({
          description: 'Replaces the default warehouse with the one the person picked.',
          input: z.object({ warehouse: z.enum(['east', 'west']) }),
          exit: ({ output, update }) => update({ warehouse: output.warehouse }),
          next: 'ship',
        }),
        // The last step's result, the tracking number, is the child's output.
        ship: step({
          run: ({ context, deps }) => deps.carrier.ship(context.orderId, context.warehouse),
        }),
      },
      { start: 'pick' },
    ),
)

export const orderFlow = defineWizard(
  {
    name: 'order',
    description: 'Charges an order, runs fulfilment as a child wizard, and returns a receipt.',
    context: z.object({ orderId: z.string(), amount: z.number().positive() }),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, flow, steps }) => {
    const pay = step({
      run: ({ context, deps }) => deps.payments.charge(context.orderId, context.amount),
      next: 'fulfil',
    })
    // Matching dependency types let the child reuse the parent's services.
    // Parent observers see child events at path ['fulfil']; child observers see path [].
    const fulfil = flow(fulfilmentFlow, {
      description: 'Runs the fulfilment wizard. Its output is the child output.',
      context: ({ context }) => ({ orderId: context.orderId }),
    })
    const receipt = step({
      needs: { fulfil },
      run: ({ context, needs }) => ({ orderId: context.orderId, tracking: needs.fulfil.tracking }),
    })
    return steps({ pay, fulfil, receipt }, { start: 'pay' })
  },
)
