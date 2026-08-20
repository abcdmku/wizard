import {
  createWebhookSubscriptions,
  type ScopeProvider,
  type WebhookStore,
} from '@openwizard/webhooks'
import type { Principal } from './auth'
import { orderFlow } from './order-flow'

export function createOrderWebhooks(auth: ScopeProvider<Principal>, store: WebhookStore) {
  return createWebhookSubscriptions(orderFlow, {
    events: ['flow.done', 'flow.failed'],
    store,
    api: { auth },
  })
}

export type OrderWebhooks = ReturnType<typeof createOrderWebhooks>
