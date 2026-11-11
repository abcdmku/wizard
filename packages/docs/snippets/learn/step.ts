import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const report = defineWizard(
  { name: 'report', context: z.object({ reportId: z.string() }) },
  ({ step, steps }) =>
    steps({
      download: step({
        run: async ({ context }) => `Downloaded ${context.reportId}`,
        next: 'done',
      }),
      done: step({ run: ({ context }) => `Report ${context.reportId} is ready` }),
    }),
)
