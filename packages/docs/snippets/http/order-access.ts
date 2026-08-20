import type { HTTPAccess } from '@openwizard/webhooks'
import type { orderFlow } from './order-flow'

export const orderAccess = {
  context: ['orderId'],
  flow: ['read', 'progress', 'next', 'cancel'],
  steps: {
    charge: ['output', 'error', 'retry'],
    address: ['input', 'issues', 'setInput'],
  },
  events: ['review.approved'],
} as const satisfies HTTPAccess<typeof orderFlow>
