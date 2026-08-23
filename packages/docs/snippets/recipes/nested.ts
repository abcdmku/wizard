import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const address = defineFlow({
  name: 'address',
  context: z.object({ city: z.string() }),
})
const addressFlow = address.steps({
  done: address.final({ output: ({ context }) => context.city }),
})

const checkout = defineFlow({
  name: 'checkout',
  context: z.object({ city: z.string() }),
})
export const checkoutFlow = checkout.steps({
  address: checkout.flow(addressFlow, {
    context: ({ context }) => ({ city: context.city }),
    next: 'done',
  }),
  done: checkout.final(),
})
