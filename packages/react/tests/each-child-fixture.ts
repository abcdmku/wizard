import { defineProjection, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const approval = defineWizard(
  {
    name: 'item-approval',
    context: z.object({ id: z.string() }),
    events: { approved: z.object({ token: z.string() }) },
  },
  ({ step, steps }) =>
    steps({
      approval: step({ waitFor: { approved: ({ payload }) => ({ done: payload.token }) } }),
    }),
)

function approvalBatch(concurrency: number) {
  return defineWizard(
    { name: 'approval-batch', context: z.object({ ids: z.array(z.string()) }) },
    ({ flow, steps }) =>
      steps({
        batch: flow(approval, {
          each: ({ context }) => context.ids,
          key: (item) => item,
          concurrency,
          context: ({ item }) => ({ id: item }),
        }),
      }),
  )
}
export const batch = approvalBatch(2)
export const serialBatch = approvalBatch(1)

export const batchClient = defineProjection(batch, {
  expose: {
    steps: {
      batch: {
        child: {
          context: ['id'],
          steps: { approval: { output: true } },
        },
      },
    },
  },
})

export const serialClient = defineProjection(serialBatch, {
  expose: {
    steps: {
      batch: {
        child: {
          context: ['id'],
          steps: { approval: { output: true } },
        },
      },
    },
  },
})

export const nested = defineWizard(
  { name: 'nested-approval-batch', context: z.object({}) },
  ({ flow, steps }) =>
    steps({
      single: flow(approval, { context: () => ({ id: 'single' }) }),
      nested: flow(batch, { context: () => ({ ids: ['one', 'two'] }) }),
    }),
)
export const nestedClient = defineProjection(nested, {
  expose: {
    steps: {
      single: { child: { context: ['id'] } },
      nested: {
        child: {
          steps: {
            batch: {
              child: {
                context: ['id'],
                steps: { approval: { output: true } },
              },
            },
          },
        },
      },
    },
  },
})
