import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const work = defineFlow({
  name: 'checks',
  context: z.object({}),
  concurrency: 2,
})

export const checks = work.steps({
  start: work.task(() => undefined, { next: ['stock', 'fraud'] }),
  stock: work.task(() => 'in-stock', { next: 'join' }),
  fraud: work.task(() => 'clear', { next: 'join' }),
  join: work.decision({
    dependsOn: ['stock', 'fraud'],
    next: () => 'done',
  }),
  done: work.final(),
})
