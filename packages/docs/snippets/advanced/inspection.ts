import { defineWizard, type RunEvent, replay } from '@openwizard/core'
import { z } from 'zod'

export const inspectProfileFlow = defineWizard(
  { name: 'inspect-profile', context: z.object({}) },
  ({ view, step, steps }) => {
    const contact = view({ input: z.object({ email: z.email() }) })
    const done = step({ needs: { contact }, run: ({ needs }) => needs.contact.email })
    return steps({ contact, done })
  },
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
