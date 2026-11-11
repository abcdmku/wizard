import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface UploadDeps {
  storage: {
    save(fileId: string, options: { idempotencyKey: string }): Promise<{ url: string }>
  }
}

export const upload = defineWizard(
  {
    name: 'upload',
    context: z.object({ fileId: z.string() }),
    deps: boundary.trusted<UploadDeps>(),
  },
  ({ step, steps }) =>
    steps({
      save: step({
        run: ({ context, deps, idempotencyKey }) =>
          deps.storage.save(context.fileId, { idempotencyKey }),
        idempotencyKey: ({ context }) => `save:${context.fileId}`,
        retry: { retries: 2, backoff: 1_000 },
      }),
    }),
)
