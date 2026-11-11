import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const dashboard = defineWizard(
  { name: 'dashboard', context: z.object({ userId: z.string() }) },
  ({ step, steps }) => {
    const profile = step({ run: async ({ context }) => ({ name: `User ${context.userId}` }) })
    const orders = step({ run: async () => [{ id: 'order-1' }, { id: 'order-2' }] })
    const summary = step({
      needs: { profile, orders },
      run: ({ needs }) => `${needs.profile.name} has ${needs.orders.length} orders`,
    })
    return steps({ profile, orders, summary }, { start: ['profile', 'orders'] })
  },
)

export const runDashboard = () => dashboard.run({ userId: '7' })
// { status: 'done', output: 'User 7 has 2 orders' }
