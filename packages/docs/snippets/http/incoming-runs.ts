import type { FlowRun } from '@openwizard/core'
import type { orderFlow } from './order-flow'

const incomingRuns = new Map<string, FlowRun<typeof orderFlow>>()

export const registerIncomingRun = (run: FlowRun<typeof orderFlow>) => incomingRuns.set(run.id, run)

export const resolveIncomingRun = (runId: string) => incomingRuns.get(runId)
