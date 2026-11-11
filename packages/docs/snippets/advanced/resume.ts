import { createMemoryStore, defineWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { z } from 'zod'

const HOUR = 60 * 60 * 1000

export const approvalFlow = defineWizard(
  {
    name: 'approval',
    version: 1,
    context: z.object({ requestId: z.string() }),
    events: { approved: z.object({ by: z.string() }) },
  },
  ({ step, steps }) => {
    const awaitDecision = step({
      waitFor: { approved: ({ payload }) => ({ done: payload.by }) },
      timeout: { after: '48h', next: 'expired' },
    })
    const approved = step({
      needs: { by: awaitDecision },
      run: ({ needs }) => `approved by ${needs.by}`,
    })
    const expired = step({ run: () => 'expired: nobody decided within 48h' })
    return steps({ awaitDecision, approved, expired })
  },
)

export async function saveAndResume() {
  const store = createMemoryStore()
  const key = 'approvals/req-1'

  const first = approvalFlow.create(
    { requestId: 'req-1' },
    {
      store,
      key,
      scheduler: createTestScheduler({ now: 0 }),
    },
  )
  await first.start()
  await first.save()
  first.dispose()

  // Three hours elapsed. The original 48-hour deadline still has 45 hours left.
  const clock = createTestScheduler({ now: 3 * HOUR })
  const second = approvalFlow.resume(await store.get(key), { store, key, scheduler: clock })
  const remaining = clock.pending()
  clock.advance(45 * HOUR)
  const result = await second.awaitResult()
  second.dispose()
  return { epoch: second.epoch, remaining, result }
}
