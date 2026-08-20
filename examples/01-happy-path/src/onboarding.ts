import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const Context = z.object({
  email: z.email(),
  company: z.string().optional(),
  role: z.enum(['founder', 'engineer', 'other']).optional(),
})
type Contact = z.infer<typeof Context>

export interface Deps {
  crm: { upsert(contact: Contact): { id: string } }
}

const onboarding = defineFlow({
  name: 'onboarding',
  context: Context,
  deps: boundary.trusted<Deps>(), // The host constructs dependencies.
})

export const onboardingFlow = onboarding.steps(
  {
    profile: onboarding.view({
      input: z.object({
        company: z.string().min(1, 'company is required'),
        role: z.enum(['founder', 'engineer', 'other']),
      }),
      exit: ({ output, update }) => update(output),
      next: 'save',
    }),
    save: onboarding.task(({ context, deps }) => deps.crm.upsert(context), { next: 'done' }),
    done: onboarding.final({ output: ({ context }) => `${context.email} @ ${context.company}` }),
  },
  { start: 'profile' },
)
