import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface OnboardingDeps {
  directory: { createAccount(name: string, team: string): Promise<{ email: string }> }
  it: { orderLaptop(name: string): Promise<{ orderId: string }> }
}

export const onboarding = defineWizard(
  {
    name: 'onboarding',
    description: 'Sets up a new hire: an account and a laptop in parallel, then a welcome.',
    context: z.object({ name: z.string() }),
    deps: boundary.trusted<OnboardingDeps>(),
    events: { 'laptop.delivered': z.object({ tracking: z.string() }) },
  },
  ({ step, view, steps }) => {
    const details = view({
      description: 'The manager picks the team and the start date.',
      input: z.object({ team: z.enum(['engineering', 'sales', 'support']), startDate: z.string() }),
    })
    const account = step({
      description: 'Creates the account in the company directory.',
      needs: { details },
      run: ({ context, deps, needs }) =>
        deps.directory.createAccount(context.name, needs.details.team),
    })
    const laptop = step({
      description: 'Orders a laptop from IT.',
      needs: { details },
      run: ({ context, deps }) => deps.it.orderLaptop(context.name),
      next: 'delivery',
    })
    const delivery = step({
      description: 'Waits up to a week for the courier to report the delivery.',
      waitFor: { 'laptop.delivered': ({ payload }) => ({ done: payload.tracking }) },
      timeout: { after: '7d', next: 'welcome' },
    })
    const welcome = step({
      description: 'Writes the welcome. It runs even when the laptop is late.',
      needs: { account, details, tracking: { optional: delivery } },
      run: ({ needs }) => ({
        email: needs.account.email,
        startDate: needs.details.startDate,
        laptop: needs.tracking ? `delivered (${needs.tracking})` : 'late, IT will follow up',
      }),
    })
    return steps({ details, account, laptop, delivery, welcome })
  },
)
