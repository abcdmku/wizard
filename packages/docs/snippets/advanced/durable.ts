import { defineWizard } from '@openwizard/core'
import {
  createDurableRun,
  createMemoryDurableStore,
  type DurableRunOpenResult,
} from '@openwizard/durable'
import { z } from 'zod'

export const durableApprovalFlow = defineWizard(
  {
    name: 'durable-approval',
    context: z.object({ requestId: z.string() }),
    events: { approved: z.object({ by: z.string() }) },
  },
  ({ step, steps }) =>
    steps({
      wait: step({ waitFor: { approved: () => undefined }, next: 'done' }),
      done: step({ run: () => undefined }),
    }),
)

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
