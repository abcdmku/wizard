import { boundary } from '../../src/authoring/boundary'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'

export const review = defineWizard(
  {
    name: 'mapped-review',
    context: boundary.trusted<{ id: string; note?: string }>(),
    events: { approved: boundary.trusted<boolean>() },
  },
  ({ view, step, steps }) =>
    steps({
      form: view({
        input: boundary.trusted<{ note: string }>(),
        exit: ({ output, update }) => update({ note: output.note }),
        next: 'approval',
      }),
      approval: step({
        waitFor: {
          approved: ({ payload, context }) => ({
            done: { id: context.id, note: context.note, accepted: payload },
          }),
        },
      }),
    }),
)

export const reviews = defineWizard(
  { name: 'mapped-reviews', context: boundary.trusted<{ ids: string[] }>() },
  ({ flow, steps }) =>
    steps({
      batch: flow(review, {
        each: ({ context }) => context.ids,
        key: (id) => id,
        concurrency: 2,
        context: ({ item }) => ({ id: item }),
      }),
    }),
)

export const reviewsClient = defineProjection(reviews, {
  expose: {
    output: true,
    waitingFor: true,
    steps: {
      batch: {
        child: {
          context: ['id', 'note'],
          steps: { form: { input: true }, approval: { output: true } },
        },
      },
    },
  },
})
