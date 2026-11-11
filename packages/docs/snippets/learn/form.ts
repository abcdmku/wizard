import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const signup = defineWizard(
  { name: 'signup', context: z.object({}) },
  ({ view, step, steps }) => {
    const contact = view({ input: z.object({ email: z.email() }) })
    const welcome = step({
      needs: { contact },
      run: ({ needs }) => `Welcome, ${needs.contact.email}`,
    })
    return steps({ contact, welcome })
  },
)

export async function submitSignup(email: string) {
  const run = signup.create({})
  try {
    await run.start() // the run waits at `contact`
    await run.setInput('contact', { email })
    const moved = await run.next() // validates the draft
    if (!moved.ok) return moved // { ok: false, code: 'INVALID_INPUT', issues: [...] }
    return await run.awaitResult() // { status: 'done', output: 'Welcome, ada@example.com' }
  } finally {
    run.dispose()
  }
}
