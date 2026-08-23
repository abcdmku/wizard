import { defineFlow } from '@openwizard/core'
import {
  createDurableRun,
  createMemoryDurableStore,
  type DurableRunOpenResult,
} from '@openwizard/durable'
import { z } from 'zod'

const approval = defineFlow({
  name: 'durable-approval',
  context: z.object({ requestId: z.string() }),
  events: { approved: z.object({ by: z.string() }) },
})

export const durableApprovalFlow = approval.steps({
  wait: approval.wait({
    on: { approved: () => undefined },
    next: 'done',
  }),
  done: approval.final(),
})

export async function demonstrateDurableOwnership() {
  const store = createMemoryDurableStore()
  const opened = await createDurableRun(durableApprovalFlow, {
    context: { requestId: 'expense-42' },
    store,
    key: 'approvals/expense-42',
    ownerId: 'worker-a',
  })

  if (!opened.ok) throw new Error(opened.code)

  const startCommand = { type: 'start' } as const
  const first = await opened.host.dispatch(startCommand, {
    commandId: 'request-123',
    expectedVersion: opened.host.version,
  })
  const duplicate = await opened.host.dispatch(startCommand, { commandId: 'request-123' })
  const competing = await createDurableRun(durableApprovalFlow, {
    context: { requestId: 'expense-42' },
    store,
    key: 'approvals/expense-42',
    ownerId: 'worker-b',
  })

  await opened.host.dispose()
  return { first, duplicate, competing: summarizeOpen(competing) }
}

function summarizeOpen(result: DurableRunOpenResult<typeof durableApprovalFlow>) {
  return result.ok ? { ok: true as const } : result
}
