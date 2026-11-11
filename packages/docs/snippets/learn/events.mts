import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

const approval = defineWizard(
  {
    name: 'approval',
    context: z.object({}),
    events: { approved: z.object({ by: z.string() }) },
  },
  ({ step, steps }) => {
    const waitForApproval = step({
      waitFor: { approved: ({ payload }) => ({ done: payload.by }) },
    })
    const done = step({ needs: { waitForApproval }, run: ({ needs }) => needs.waitForApproval })
    return steps({ waitForApproval, done })
  },
)

const run = approval.create({})
await run.start()
await run.send('approved', { by: 'Grace' }, { eventId: 'approval-42' })

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error('approval did not finish')
run.dispose()
