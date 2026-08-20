import { trace } from '@opentelemetry/api'
import type { FlowRun } from '@openwizard/core'
import { instrumentRun } from '@openwizard/opentelemetry'
import type { orderFlow } from './order-flow'

export function traceOrder(run: FlowRun<typeof orderFlow>) {
  const telemetry = instrumentRun(run, {
    tracer: trace.getTracer('orders'),
  })

  const carrier: Record<string, string> = {}
  telemetry.inject(carrier)
  return { carrier, telemetry }
}
