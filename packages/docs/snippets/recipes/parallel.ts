import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const dashboard = defineFlow({
  name: 'dashboard',
  context: z.object({ userId: z.string() }),
})

export const dashboardFlow = dashboard.steps(
  {
    loadProfile: dashboard.task(async () => 'profile', { next: 'join' }),
    loadOrders: dashboard.task(async () => 'orders', { next: 'join' }),
    join: dashboard.decision({
      dependsOn: ['loadProfile', 'loadOrders'],
      next: () => 'done',
    }),
    done: dashboard.final(),
  },
  { start: ['loadProfile', 'loadOrders'] },
)
