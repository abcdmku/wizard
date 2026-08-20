import { createMemoryStore, createRun, defineFlow, resumeRun } from '@openwizard/core'
import { z } from 'zod'

const approval = defineFlow({
  name: 'approval',
  context: z.object({ requestId: z.string() }),
})

const approvalFlow = approval.steps({
  review: approval.view({ next: 'done' }),
  done: approval.final(),
})

const store = createMemoryStore()
const key = 'tenant-a/approvals/42'
const run = createRun(approvalFlow, {
  context: { requestId: '42' },
  store,
  key,
})

await run.start()
await run.save()

const saved = await store.get(key)
if (saved === null) throw new Error('run not found')

export const resumed = resumeRun(approvalFlow, saved, { store, key })
