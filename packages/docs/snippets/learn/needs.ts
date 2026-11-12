import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface DashboardDeps {
  users: { find(userId: string): Promise<{ name: string }> }
  orders: { list(userId: string): Promise<{ id: string }[]> }
}

export const dashboard = defineWizard(
  {
    name: 'dashboard',
    context: z.object({ userId: z.string() }),
    deps: boundary.trusted<DashboardDeps>(),
  },
  ({ step, steps }) => {
    const profile = step({ run: ({ context, deps }) => deps.users.find(context.userId) })
    const orders = step({ run: ({ context, deps }) => deps.orders.list(context.userId) })
    const summary = step({
      needs: { profile, orders },
      run: ({ needs }) => `${needs.profile.name} has ${needs.orders.length} orders`,
    })
    return steps({ profile, orders, summary }, { start: ['profile', 'orders'] })
  },
)

export const runDashboard = (deps: DashboardDeps) => dashboard.run({ userId: '7' }, { deps })
// { status: 'done', output: 'User 7 has 2 orders' }
