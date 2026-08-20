import {
  createHTTP,
  type ScopeProvider,
  type WebhookSecret,
  type WebhookStore,
} from '@openwizard/webhooks'
import type { Principal } from './auth'
import { resolveIncomingRun } from './incoming-runs'
import { orderFlow } from './order-flow'
import { createOrderWebhooks } from './order-webhooks'
import { runs } from './runs'

export function createOrderRegistry(
  auth: ScopeProvider<Principal>,
  webhookStore: WebhookStore,
  incomingSecret: WebhookSecret,
) {
  const outgoing = createOrderWebhooks(auth, webhookStore)

  return createHTTP(orderFlow, {
    api: { auth, data: runs },
    receive: {
      secret: incomingSecret,
      resolve: ({ envelope }) =>
        envelope.subject === undefined ? undefined : resolveIncomingRun(envelope.subject),
    },
    outbound: outgoing,
  })
}
