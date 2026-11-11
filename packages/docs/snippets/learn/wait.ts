import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const approval = defineWizard(
  {
    name: 'approval',
    context: z.object({}),
    events: { approved: z.object({ by: z.string() }) },
  },
  ({ step, steps }) => {
    const decision = step({
      waitFor: { approved: ({ payload }) => ({ done: payload.by }) },
      timeout: { after: '48h', next: 'close' },
    })
    const close = step({
      // After a timeout the wait has no output, so the need is optional.
      needs: { by: { optional: decision } },
      run: ({ needs }) => (needs.by ? `Approved by ${needs.by}` : 'Expired after 48 hours'),
    })
    return steps({ decision, close })
  },
)

export async function approve() {
  const run = approval.create({})
  await run.start() // the run waits at `decision`
  await run.send('approved', { by: 'Grace' })
  const result = await run.awaitResult() // { status: 'done', output: 'Approved by Grace' }
  run.dispose()
  return result
}
