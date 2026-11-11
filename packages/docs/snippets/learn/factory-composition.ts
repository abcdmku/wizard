import { defineWizard, type StepApi } from '@openwizard/core'
import { z } from 'zod'
import { signup } from './factory-form'

// An ordinary function can package a set of steps. Literal references are checked
// when the caller assembles the full map, including references across modules.
function auditSteps<C, Ev, D>({ step }: StepApi<C, Ev, D>) {
  return { audit: step({ run: () => 'recorded' }) }
}

export const onboarding = defineWizard(
  {
    name: 'onboarding',
    context: z.object({ email: z.string().default('') }),
    output: ({ context }) => context.email,
  },
  (api) =>
    api.steps({
      signup: api.flow(signup, {
        context: () => ({}),
        exit: ({ output, update }) => update({ email: output.email }),
        next: 'audit',
      }),
      ...auditSteps(api),
    }),
)
