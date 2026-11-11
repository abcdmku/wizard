import { defineProjection, defineWizard, type ProjectionOutput } from '@openwizard/core'
import type { Mirror } from '@openwizard/core/mirror'
import { z } from 'zod'

const review = defineWizard(
  { name: 'review', context: z.object({ orderId: z.string() }) },
  ({ view, step, steps }) => {
    const decision = view({ input: z.object({ approved: z.boolean() }) })
    const result = step({
      needs: { decision },
      run: ({ context, needs }) => ({
        orderId: context.orderId,
        approved: needs.decision.approved,
      }),
    })
    return steps({ decision, result })
  },
)

export const reviews = defineWizard(
  { name: 'reviews', context: z.object({ orderIds: z.array(z.string()) }) },
  ({ flow, steps }) =>
    steps({
      batch: flow(review, {
        each: ({ context }) => context.orderIds,
        key: (orderId) => orderId,
        concurrency: 2,
        context: ({ item }) => ({ orderId: item }),
      }),
    }),
)

export const reviewsSummary = defineProjection(reviews, {
  expose: { steps: { batch: { child: true } } },
})

export const reviewsClient = defineProjection(reviews, {
  expose: {
    waitingFor: true,
    steps: {
      batch: {
        child: { context: ['orderId'], steps: { decision: { input: true, issues: true } } },
      },
    },
  },
})

export function summaryAt(state: ProjectionOutput<typeof reviewsSummary>, index: number) {
  return state.steps.batch.child?.[index]?.status ?? 'pending'
}

export async function approveAll() {
  const run = reviews.create({ orderIds: ['order-a', 'order-b'] })
  try {
    await run.start()
    // A local mapped child accepts either its saved key or its input index.
    const first = run.child('batch', 'order-a')
    const second = run.child('batch', 1)
    await first.setInput('decision', { approved: true })
    await first.next()
    await second.setInput('decision', { approved: false })
    await second.next()
    return await run.awaitResult()
  } finally {
    run.dispose()
  }
}

export async function approveRemoteFirst(mirror: Mirror<typeof reviewsClient>) {
  // Remote mapped children use the input index.
  const child = mirror.child('batch', 0)
  const changed = await child.setInput('decision', { approved: true })
  return changed.ok ? child.next() : changed
}
