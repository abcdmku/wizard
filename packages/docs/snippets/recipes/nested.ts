import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

const address = defineWizard(
  { name: 'address', context: z.object({ city: z.string() }) },
  ({ step, steps }) => steps({ city: step({ run: ({ context }) => context.city }) }),
)

export const checkout = defineWizard(
  { name: 'checkout', context: z.object({ city: z.string() }) },
  ({ child, steps }) =>
    steps({
      address: child(address, { context: ({ context }) => ({ city: context.city }) }),
    }),
)
