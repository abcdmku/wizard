import { defineWizard, type StepApi } from '@openwizard/core'
import { z } from 'zod'
import { signup } from './factory-form'

// An ordinary function can package a set of steps. Literal references are checked
// when the caller assembles the full map, including references across modules.
function auditSteps<C, Ev, D>({ step }: StepApi<C, Ev, D>) {
  return { audit: step({ run: () => 'recorded' }) }
}

export const onboarding = defineWizard({ name: 'onboarding', context: z.object({}) }, (api) => {
  const account = api.flow(signup, { context: () => ({}), next: 'audit' })
  const auditing = auditSteps(api)
  // `welcome` needs the audit only to run after it. The child's output arrives typed.
  const welcome = api.step({
    needs: { account, audit: auditing.audit },
    run: ({ needs }) => needs.account.email,
  })
  return api.steps({ signup: account, ...auditing, welcome })
})
