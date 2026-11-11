import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const signupFlow = defineWizard(
  { name: 'signup', context: z.object({}) },
  ({ view, step, steps }) => {
    const contact = view({ input: z.object({ email: z.email() }) })
    // `done` needs the view, so it starts once `next()` accepts the draft.
    const done = step({ needs: { contact }, run: ({ needs }) => needs.contact.email })
    return steps({ contact, done })
  },
)
