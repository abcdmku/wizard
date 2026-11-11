import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const thumbnails = defineWizard(
  { name: 'thumbnails', context: z.object({ files: z.array(z.string()) }) },
  ({ step, steps }) =>
    steps({
      resize: step({
        each: ({ context }) => context.files,
        concurrency: 4,
        run: async ({ item, index }) => `${index}:${item}.thumb`,
      }),
    }),
)

export const runThumbnails = () => thumbnails.run({ files: ['a.png', 'b.png'] })
// { status: 'done', output: ['0:a.png.thumb', '1:b.png.thumb'] }
