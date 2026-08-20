import type { OrderWebhooks } from './order-webhooks'

export async function deliverOrderWebhooks(webhooks: OrderWebhooks) {
  return webhooks.work({ limit: 100, concurrency: 10 })
}
