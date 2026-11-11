import { defineProjection, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const projectedCheckout = defineWizard(
  {
    name: 'projected-checkout',
    context: z.object({ cartId: z.string(), total: z.number() }),
  },
  ({ view, step, steps }) =>
    steps({
      payment: view({
        input: z.object({ paymentToken: z.string(), last4: z.string() }),
        next: 'receipt',
      }),
      receipt: step({ run: ({ context }) => ({ total: context.total }) }),
    }),
)

export const checkoutClient = defineProjection(projectedCheckout, {
  expose: {
    context: ['total'],
    output: true,
    steps: { payment: { issues: true } },
  },
})

export function projectCheckout() {
  const run = projectedCheckout.create({ cartId: 'cart-42', total: 129.5 })
  const clientState = run.project(checkoutClient)
  run.dispose()
  return clientState
}
