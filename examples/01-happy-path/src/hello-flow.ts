import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const hello = defineFlow({
  name: 'hello',
  context: z.object({ name: z.string() }),
})

export const helloFlow = hello.steps({
  done: hello.final({
    output: ({ context }) => `Hello, ${context.name}!`,
  }),
})
