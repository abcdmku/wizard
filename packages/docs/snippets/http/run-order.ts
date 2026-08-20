import type { FlowRun } from '@openwizard/core'
import type { orderFlow } from './order-flow'
import type { OrderWebhooks } from './order-webhooks'

export async function startOrder(
  webhooks: OrderWebhooks,
  run: FlowRun<typeof orderFlow>,
  tenantId: string,
) {
  const delivery = webhooks.attach(run, { tenantId })

  try {
    await run.start()
    await delivery.flush()
  } finally {
    delivery.dispose()
  }
}
