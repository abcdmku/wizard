/**
 * Runnable walk-through: `pnpm --filter example-01-happy-path start`.
 * Prints the domain events the wizard emits while a user fills the form and the CRM task runs.
 */
import { createWizard, type WizardEvent } from '@openwizard/core'
import { type Deps, onboarding } from './onboarding'

const deps: Deps = {
  crm: { upsert: (contact) => ({ id: `crm_${contact.email}` }) },
}

const wizard = createWizard(onboarding, { context: { email: 'ada@example.com' }, deps })
wizard.observe((event: WizardEvent<typeof onboarding>) => {
  const step = 'step' in event && typeof event.step === 'string' ? ` ${event.step}` : ''
  console.log(`${String(event.seq).padStart(3)}  ${event.type}${step}`)
})

await wizard.start()
console.log('current view:', wizard.getState().current)

// A first attempt with an empty draft: rejected as a value, with the schema's issues.
const rejected = await wizard.next()
console.log('next() with an empty draft →', JSON.stringify(rejected))

await wizard.setInput('profile', { company: 'Acme', role: 'engineer' })
const ok = await wizard.next()
console.log('next() with a valid draft →', JSON.stringify(ok))

const state = wizard.getState()
console.log(
  'status:',
  state.status,
  '| crm id:',
  state.steps.save.output?.id,
  '| output:',
  state.output,
)
wizard.dispose()
