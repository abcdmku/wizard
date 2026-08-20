import type { FlowRun } from '@openwizard/core'
import type { RunDataLayer } from '@openwizard/webhooks'
import type { orderFlow } from './order-flow'

export interface OrderRunOwner {
  get(tenantId: string, runId: string): Promise<FlowRun<typeof orderFlow> | undefined>
}

export function createRunDataLayer(owner: OrderRunOwner): RunDataLayer<typeof orderFlow> {
  return { get: (tenantId, runId) => owner.get(tenantId, runId) }
}
