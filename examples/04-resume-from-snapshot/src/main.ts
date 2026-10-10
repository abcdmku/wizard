/**
 * Runnable walk-through: `pnpm --filter example-04-resume-from-snapshot start`.
 * Process 1 reaches the wait step and auto-saves; "crashes"; process 2 resumes from the store
 * three hours later (virtual time) and the 48h deadline still fires.
 */
import { createMemoryStore, createWizard, resumeWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { approval, type Deps } from './approval'

const HOUR = 3_600_000
const deps: Deps = { notifier: { requestApproval: async (id) => ({ ticket: `TCK-${id}` }) } }
const store = createMemoryStore()
const key = 'tenant-a/expense-approval/42'
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

// ── process 1 ─────────────────────────────────────────────────────────────────────────────
const sched1 = createTestScheduler({ now: 0 })
const first = createWizard(approval, {
  context: { requestId: '42', amount: 1_250 },
  deps,
  store,
  key,
  scheduler: sched1,
})
await first.start()
await settle()
await first.save()
console.log(
  'process 1: status',
  first.getState().status,
  '| deadline at',
  first.getState().steps.awaitDecision.deadline,
)
first.dispose()
console.log('process 1: 💥 crashed')

// ── process 2, three hours later ──────────────────────────────────────────────────────────
const sched2 = createTestScheduler({ now: 3 * HOUR })
const resumed = resumeWizard(approval, await store.get(key), {
  deps,
  store,
  key,
  scheduler: sched2,
})
resumed.observe((event) => {
  if (event.type === 'timer.fired' || event.type === 'step.done' || event.type === 'flow.done')
    console.log(
      `process 2: seq ${event.seq} ${event.type}${'step' in event ? ` ${event.step}` : ''}`,
    )
})
console.log(
  'process 2: resumed epoch',
  resumed.epoch,
  '| first event:',
  resumed.log()[0]?.type,
  '| status',
  resumed.getState().status,
)
sched2.advance(45 * HOUR)
console.log('process 2: status', resumed.getState().status, '| output:', resumed.getState().output)
resumed.dispose()
