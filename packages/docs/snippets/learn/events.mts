import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

const approval = defineWizard(
  {
    name: 'approval',
    context: z.object({ approvedBy: z.string().optional() }),
    events: { approved: z.object({ by: z.string() }) },
  },
  ({ step, steps }) =>
    steps({
      waitForApproval: step({
        waitFor: {
          approved: ({ payload, update }) => {
            update({ approvedBy: payload.by })
            return { done: payload.by }
          },
        },
        next: 'done',
      }),
      done: step({ run: ({ context }) => context.approvedBy }),
    }),
)

const run = approval.create({})
await run.start()
await run.send('approved', { by: 'Grace' }, { eventId: 'approval-42' })

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error('approval did not finish')
run.dispose()
