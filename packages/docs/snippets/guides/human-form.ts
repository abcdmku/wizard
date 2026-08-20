import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const signup = defineFlow({
  name: 'signup',
  context: z.object({ name: z.string().optional() }),
})

const signupFlow = signup.steps(
  {
    details: signup.view({
      input: z.object({ name: z.string().min(1) }),
      exit: ({ output, update }) => update(output),
      next: 'done',
    }),
    done: signup.final({ output: ({ context }) => `Hello ${context.name}` }),
  },
  { start: 'details' },
)

const run = createRun(signupFlow, { context: {} })
await run.start()

const patched = await run.setInput('details', { name: 'Ada' })
if (!patched.ok) throw new Error(patched.message)

const advanced = await run.next()
if (!advanced.ok) throw new Error(advanced.message)

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error(result.status)
export const output = result.output
run.dispose()
