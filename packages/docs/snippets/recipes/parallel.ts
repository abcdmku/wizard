import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const dashboard = defineWizard(
  { name: 'dashboard', context: z.object({ userId: z.string() }) },
  ({ step, steps }) => {
    const loadProfile = step({ run: async () => ({ name: 'Ada' }) })
    const loadOrders = step({ run: async () => [{ id: 'order-1' }] })
    const join = step({
      needs: { loadProfile, loadOrders },
      run: ({ needs }) => ({ name: needs.loadProfile.name, orders: needs.loadOrders.length }),
    })
    return steps({ loadProfile, loadOrders, join }, { start: ['loadProfile', 'loadOrders'] })
  },
)
