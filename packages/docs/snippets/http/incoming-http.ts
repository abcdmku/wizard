import { createHTTP } from '@openwizard/webhooks'
import { resolveIncomingRun } from './incoming-runs'
import { orderFlow } from './order-flow'

const signingSecret = process.env.ORDER_WEBHOOK_SECRET
if (signingSecret === undefined) throw new Error('ORDER_WEBHOOK_SECRET is required')

export const incomingHTTP = createHTTP(orderFlow, {
  receive: {
    secret: signingSecret,
    resolve: ({ envelope }) =>
      envelope.subject === undefined ? undefined : resolveIncomingRun(envelope.subject),
  },
})
