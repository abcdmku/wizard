import { defineProjection, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const mappedLeaf = defineWizard(
  { name: 'mapped-leaf', context: z.object({ name: z.string() }) },
  ({ view, steps }) =>
    steps({
      form: view({ input: z.object({ confirmed: z.boolean() }), initial: { confirmed: false } }),
    }),
)

export const numericChild = defineWizard(
  { name: 'numeric-child', context: z.object({ name: z.string() }) },
  ({ flow, steps }) => steps({ '0': flow(mappedLeaf, { context: ({ context }) => context }) }),
)

export const mappedParent = defineWizard(
  { name: 'mapped-parent', context: z.object({ names: z.array(z.string()) }) },
  ({ flow, steps }) =>
    steps({
      batch: flow(numericChild, {
        each: ({ context }) => context.names,
        context: ({ item }) => ({ name: item }),
        key: (_item, index) => String(1 - index),
        concurrency: 2,
      }),
    }),
)

export const mappedProjection = defineProjection(mappedParent, {
  expose: {
    steps: {
      batch: {
        child: {
          steps: {
            '0': {
              child: {
                context: ['name'],
                steps: { form: { input: true } },
              },
            },
          },
        },
      },
    },
  },
})
