import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const order = defineFlow({
  name: 'order',
  context: z.object({ orderId: z.string(), total: z.number().positive() }),
})

const orderFlow = order.steps({
  prepare: order.task(({ context }) => ({ amount: context.total }), { next: 'done' }),
  done: order.final({
    output: ({ context }) => ({ orderId: context.orderId, status: 'ready' as const }),
  }),
})

const run = createRun(orderFlow, {
  context: { orderId: 'o-42', total: 42 },
})

await run.start()
const result = await run.awaitResult()

if (result.status !== 'done') throw new Error(result.status)
process.stdout.write(`${JSON.stringify(result.output)}\n`)
