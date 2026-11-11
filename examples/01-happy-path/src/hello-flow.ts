import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const helloFlow = defineWizard(
  { name: 'hello', context: z.object({ name: z.string() }) },
  ({ step, steps }) =>
    steps({
      // With one sink and no output selector, the wizard returns this step's result.
      greet: step({ run: ({ context }) => `Hello, ${context.name}!` }),
    }),
)
