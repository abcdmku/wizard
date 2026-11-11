import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const hello = defineWizard(
  { name: 'hello', context: z.object({ name: z.string() }) },
  ({ step, steps }) => steps({ greet: step({ run: ({ context }) => `Hello, ${context.name}!` }) }),
)

export const result = hello.runSync({ name: 'Ada' })
if (result.status === 'done') {
  // biome-ignore lint/suspicious/noConsole: display the quickstart result
  console.log(result.output)
}
