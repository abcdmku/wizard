import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const upload = defineFlow({
  name: 'upload',
  context: z.object({ fileId: z.string() }),
})

export const uploadFlow = upload.steps({
  save: upload.task(
    async ({ attempt, context }) => {
      if (attempt < 3) throw new Error('storage is busy')
      return { saved: context.fileId }
    },
    {
      retry: { attempts: 2, backoff: 1_000 },
      next: 'done',
    },
  ),
  done: upload.final({ output: () => 'saved' }),
})
