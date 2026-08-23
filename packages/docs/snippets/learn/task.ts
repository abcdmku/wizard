import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const report = defineFlow({
  name: 'report',
  context: z.object({ reportId: z.string() }),
})

export const reportFlow = report.steps({
  download: report.task(
    async ({ context }) => {
      return `Downloaded ${context.reportId}`
    },
    { next: 'done' },
  ),
  done: report.final({
    output: ({ context }) => `Report ${context.reportId} is ready`,
  }),
})
