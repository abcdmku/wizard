import { defineWizard, type RunEvent, replay } from '@openwizard/core'
import { z } from 'zod'

export const inspectProfileFlow = defineWizard(
  { name: 'inspect-profile', context: z.object({ email: z.string().optional() }) },
  ({ view, step, steps }) =>
    steps({
      contact: view({
        input: z.object({ email: z.email() }),
        exit: ({ output, update }) => update({ email: output.email }),
        next: 'done',
      }),
      done: step({ run: ({ context }) => context.email }),
    }),
)

export async function inspectProfileRun() {
  const run = inspectProfileFlow.create({}, { logSize: 100 })
  const events: RunEvent<typeof inspectProfileFlow>[] = []
  run.observe((event) => events.push(event))
  await run.start()
  const waiting = run.explain('contact')
  await run.setInput('contact', { email: 'ada@example.com' })
  await run.next()

  const live = run.getState()
  const rebuilt = replay(inspectProfileFlow, events, { context: {}, instanceId: run.id })
  const progress = run.progress()
  run.dispose()
  return { waiting, live, rebuilt, progress, events }
}
