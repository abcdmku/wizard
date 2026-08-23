import { createRun, defineFlow, defineProjection } from '@openwizard/core'
import { z } from 'zod'

const checkout = defineFlow({
  name: 'projected-checkout',
  context: z.object({
    cartId: z.string(),
    total: z.number(),
    paymentToken: z.string().optional(),
  }),
})

export const projectedCheckoutFlow = checkout.steps({
  payment: checkout.view({
    input: z.object({ paymentToken: z.string(), last4: z.string() }),
    exit: ({ output, update }) => update({ paymentToken: output.paymentToken }),
    next: 'receipt',
  }),
  receipt: checkout.final({
    output: ({ context }) => ({ total: context.total }),
  }),
})

export const checkoutClient = defineProjection(projectedCheckoutFlow, {
  expose: {
    steps: { payment: { input: true, issues: true } },
    context: ['total'],
    output: true,
  },
})

export function projectCheckout() {
  const run = createRun(projectedCheckoutFlow, {
    context: { cartId: 'cart-42', total: 129.5 },
  })
  const clientState = run.project(checkoutClient)
  run.dispose()
  return clientState
}
