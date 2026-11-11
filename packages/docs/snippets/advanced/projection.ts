import { defineProjection, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const projectedCheckoutFlow = defineWizard(
  {
    name: 'projected-checkout',
    context: z.object({
      cartId: z.string(),
      total: z.number(),
      paymentToken: z.string().optional(),
    }),
  },
  ({ view, step, steps }) =>
    steps({
      payment: view({
        input: z.object({ paymentToken: z.string(), last4: z.string() }),
        exit: ({ output, update }) => update({ paymentToken: output.paymentToken }),
        next: 'receipt',
      }),
      receipt: step({ run: ({ context }) => ({ total: context.total }) }),
    }),
)

export const checkoutClient = defineProjection(projectedCheckoutFlow, {
  expose: {
    context: ['total'],
    output: true,
    steps: { payment: { issues: true } },
  },
})

export function projectCheckout() {
  const run = projectedCheckoutFlow.create({ cartId: 'cart-42', total: 129.5 })
  const clientState = run.project(checkoutClient)
  run.dispose()
  return clientState
}
