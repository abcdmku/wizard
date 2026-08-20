import { defineFlow } from '@openwizard/core'
import { createDurableRun, createMemoryDurableStore, resumeDurableRun } from '@openwizard/durable'
import { z } from 'zod'

const job = defineFlow({
  name: 'job',
  context: z.object({ result: z.string().optional() }),
  events: { complete: z.object({ result: z.string() }) },
})

const jobFlow = job.steps(
  {
    waiting: job.wait({
      on: { complete: ({ payload, update }) => update({ result: payload.result }) },
      next: 'done',
    }),
    done: job.final({ output: ({ context }) => context.result }),
  },
  { start: 'waiting' },
)

const store = createMemoryDurableStore()
const key = 'tenant-a/jobs/j-42'

const opened = await createDurableRun(jobFlow, {
  store,
  key,
  ownerId: 'worker-a',
  context: {},
})
if (!opened.ok) throw new Error(opened.code)

const started = await opened.host.dispatch(
  { type: 'start' },
  { commandId: 'request-1', expectedVersion: opened.host.version },
)
if (!started.ok) throw new Error(started.code)
await opened.host.release()

const resumed = await resumeDurableRun(jobFlow, {
  store,
  key,
  ownerId: 'worker-b',
})
if (!resumed.ok) throw new Error(resumed.code)

const sent = await resumed.host.send(
  'complete',
  { result: 'finished' },
  { eventId: 'provider-event-1', expectedVersion: resumed.host.version },
)
if (!sent.ok) throw new Error(sent.code)

const result = await resumed.host.run.awaitResult()
if (result.status !== 'done') throw new Error(result.status)
export const output = result.output
await resumed.host.dispose()
