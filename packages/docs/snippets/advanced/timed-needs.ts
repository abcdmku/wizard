import { defineWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { z } from 'zod'

export const approval = defineWizard(
  {
    name: 'timed-approval',
    context: z.object({}),
    events: { decided: z.object({ accepted: z.boolean() }) },
  },
  ({ step, steps }) => {
    const decision = step({
      waitFor: { decided: ({ payload }) => ({ done: payload.accepted }) },
      next: 'summary',
      timeout: { after: '1s', next: 'summary' },
    })
    const summary = step({
      needs: { decision },
      run: ({ needs }) =>
        needs.decision === undefined ? 'expired' : needs.decision ? 'approved' : 'rejected',
    })
    return steps({ decision, summary })
  },
)

export async function expireApproval() {
  const clock = createTestScheduler()
  const run = approval.create({}, { scheduler: clock })
  try {
    await run.start()
    clock.advance(1_000)
    return await run.awaitResult()
  } finally {
    run.dispose()
  }
}
