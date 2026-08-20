/**
 * Runnable walk-through: `pnpm --filter example-01-happy-path start`.
 * Prints the domain events the run emits while a user fills the form and the CRM task runs.
 */
import { createRun, type RunEvent } from '@openwizard/core'
import { type Deps, onboardingFlow } from './onboarding'

const deps: Deps = {
  crm: { upsert: (contact) => ({ id: `crm_${contact.email}` }) },
}

const run = createRun(onboardingFlow, { context: { email: 'ada@example.com' }, deps })
run.observe((event: RunEvent<typeof onboardingFlow>) => {
  const step = 'step' in event && typeof event.step === 'string' ? ` ${event.step}` : ''
  console.log(`${String(event.seq).padStart(3)}  ${event.type}${step}`)
})

await run.start()
console.log('current view:', run.getState().current)

// A first attempt with an empty draft: rejected as a value, with the schema's issues.
const rejected = await run.next()
console.log('next() with an empty draft →', JSON.stringify(rejected))

await run.setInput('profile', { company: 'Acme', role: 'engineer' })
const ok = await run.next()
console.log('next() with a valid draft →', JSON.stringify(ok))

const state = run.getState()
console.log(
  'status:',
  state.status,
  '| crm id:',
  state.steps.save.output?.id,
  '| output:',
  state.output,
)
run.dispose()
