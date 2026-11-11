import { defineProjection, defineWizard } from '@openwizard/core'
import { z } from 'zod'

const upload = defineWizard({ name: 'upload', context: z.object({}) }, ({ step, steps }) =>
  steps({
    upload: step({
      run: ({ progress }) => {
        progress({ bytes: 1024 })
        return 'uploaded'
      },
    }),
  }),
)

const job = defineWizard({ name: 'job', context: z.object({}) }, ({ step, child, steps }) =>
  steps({
    nested: child(upload, { context: () => ({}), next: 'work' }),
    work: step({
      run: ({ progress }) => {
        progress({ phase: 'indexing' })
        return 'indexed'
      },
    }),
  }),
)

export const selected = defineProjection(job, {
  select: (state) => ({ status: state.status, step: state.current }),
  progress: { work: true, nested: { child: { upload: true } } },
})

export const exposed = defineProjection(job, {
  expose: {
    progress: true,
    waitingFor: true,
    steps: {
      work: { progress: true },
      nested: { child: { steps: { upload: { progress: true } } } },
    },
  },
})
