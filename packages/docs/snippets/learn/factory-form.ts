import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const signup = defineWizard(
  { name: 'signup', context: z.object({ email: z.string().default('') }) },
  ({ view, steps }) =>
    steps({
      contact: view({
        input: z.object({ email: z.email() }),
        exit: ({ output, update }) => update({ email: output.email }),
      }),
    }),
)

export async function submitSignup(email: string) {
  const run = signup.create({})
  try {
    await run.start()
    await run.setInput('contact', { email })
    const navigation = await run.next()
    if (!navigation.ok) return navigation
    return await run.awaitResult()
  } finally {
    run.dispose()
  }
}
