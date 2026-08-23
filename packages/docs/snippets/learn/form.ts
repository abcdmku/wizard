import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const signup = defineFlow({
  name: 'signup',
  context: z.object({ email: z.email().optional() }),
})

export const signupFlow = signup.steps({
  contact: signup.view({
    input: z.object({ email: z.email() }),
    exit: ({ output, update }) => update({ email: output.email }),
    next: 'done',
  }),
  done: signup.final({
    output: ({ context }) => context.email,
  }),
})
