import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const approval = defineFlow({
  name: 'approval',
  context: z.object({ approvedBy: z.string().optional() }),
  events: {
    approved: z.object({ by: z.string() }),
  },
})

const approvalFlow = approval.steps({
  waitForApproval: approval.wait({
    on: {
      approved: ({ payload, update }) => update({ approvedBy: payload.by }),
    },
    next: 'done',
  }),
  done: approval.final({ output: ({ context }) => context.approvedBy }),
})

const run = createRun(approvalFlow, { context: {} })
await run.start()
await run.send('approved', { by: 'Grace' })

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error('approval did not finish')
run.dispose()
