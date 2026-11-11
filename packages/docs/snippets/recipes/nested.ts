import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

const address = defineWizard(
  { name: 'address', context: z.object({ city: z.string() }) },
  ({ step, steps }) => steps({ city: step({ run: ({ context }) => context.city }) }),
)

export const checkoutFlow = defineWizard(
  { name: 'checkout', context: z.object({ city: z.string() }) },
  ({ flow, steps }) =>
    steps({
      address: flow(address, { context: ({ context }) => ({ city: context.city }) }),
    }),
)
