import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const signupFlow = defineWizard(
  { name: 'signup', context: z.object({ email: z.email().optional() }) },
  ({ view, step, steps }) =>
    steps({
      contact: view({
        input: z.object({ email: z.email() }),
        exit: ({ output, update }) => update({ email: output.email }),
        next: 'done',
      }),
      done: step({ run: ({ context }) => context.email }),
    }),
)
