import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const uploadFlow = defineWizard(
  { name: 'upload', context: z.object({ fileId: z.string() }) },
  ({ step, steps }) =>
    steps({
      save: step({
        run: async ({ attempt, context }) => {
          if (attempt < 3) throw new Error('storage is busy')
          return { saved: context.fileId }
        },
        mapError: (error, { attempt }) => ({
          code: error instanceof Error && error.message === 'storage is busy' ? 'BUSY' : 'REJECTED',
          attempt,
        }),
        retry: { attempts: 2, backoff: 1_000, when: (error) => error.code === 'BUSY' },
        next: 'done',
      }),
      done: step({ run: () => 'saved' }),
    }),
)
