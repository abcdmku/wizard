import {
  createWebhookSubscriptions,
  defineOutboundEvents,
  type ScopeProvider,
  type WebhookStore,
} from '@openwizard/webhooks'
import { z } from 'zod'
import type { Principal } from './auth'

const events = defineOutboundEvents({
  'order.completed.v1': z.object({ orderId: z.string() }),
})

export function createPartnerWebhooks(auth: ScopeProvider<Principal>, store: WebhookStore) {
  return createWebhookSubscriptions({
    id: 'orders',
    events,
    store,
    api: { auth },
  })
}
