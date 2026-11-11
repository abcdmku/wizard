import { defineProjection, defineWizard, type Run } from '@openwizard/core'
import { createMirrorSource } from '@openwizard/core/mirror'
import { z } from 'zod'

export const checkout = defineWizard(
  { name: 'checkout', context: z.object({ cartId: z.string(), total: z.number() }) },
  ({ view, step, steps }) => {
    const payment = view({ input: z.object({ cardToken: z.string().min(1) }) })
    const receipt = step({ needs: { payment }, run: ({ context }) => ({ paid: context.total }) })
    return steps({ payment, receipt })
  },
)

/** The client sees `total`, the payment issues and the final output. Nothing else. */
export const checkoutClient = defineProjection(checkout, {
  expose: { context: ['total'], output: true, steps: { payment: { issues: true } } },
})

/** One source per signed-in viewer. It sends frames out and takes commands in. */
export const serveCheckout = (run: Run<typeof checkout>) =>
  createMirrorSource(run, checkoutClient, {
    authorize: ({ command }) => command.type === 'setInput' || command.type === 'next',
  })
