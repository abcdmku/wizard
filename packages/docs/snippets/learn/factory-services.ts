import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

// The service contract is the only application type we declare.
type Services = {
  lookup: (id: string) => Promise<{ name: string }>
  log: (message: string) => void
}

export const customer = defineWizard(
  {
    name: 'customer',
    output: ({ context }) => ({ id: context.id, name: context.name }),
    context: z.object({ id: z.string(), name: z.string().default('') }),
    deps: boundary.trusted<Services>(),
    onFailure: 'compensate',
  },
  ({ step, steps }) =>
    steps({
      lookup: step({
        run: async ({ context, deps }) => deps.lookup(context.id),
        exit: ({ output, update, deps }) => {
          update({ name: output.name })
          deps.log(`Loaded ${output.name}`)
        },
      }),
    }),
)

export const localCustomer = customer
  .provide({ log: () => {} })
  .provide({ lookup: async (id) => ({ name: `Customer ${id}` }) })

// Each call has independent state. The supplied service implementations are shared.
export const loadCustomer = (id: string) => localCustomer.run({ id })
