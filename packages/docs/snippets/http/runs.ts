import type { FlowRun } from '@openwizard/core'
import type { RunDataLayer } from '@openwizard/webhooks'
import type { orderFlow } from './order-flow'

const live = new Map<string, FlowRun<typeof orderFlow>>()
const key = (tenantId: string, runId: string) => `${tenantId}:${runId}`

export const runs: RunDataLayer<typeof orderFlow> = {
  get: (tenantId, runId) => live.get(key(tenantId, runId)),
}

export function registerRun(tenantId: string, run: FlowRun<typeof orderFlow>) {
  live.set(key(tenantId, run.id), run)
}
