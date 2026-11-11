import type { VehicleTelemetry } from '@openwizard/fleet-shared'
import { Effect } from 'effect'
import { ActionFailure, type DeliveryContext } from './delivery-model'
import { scoreAnomaly } from './score-policy'

export function mapActionFailure(error: unknown) {
  return {
    code: error instanceof ActionFailure ? error.code : 'DELIVERY_HOOK_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function telemetrySeverity(telemetry: VehicleTelemetry) {
  if (telemetry.fault !== undefined) return telemetry.fault.severity
  if (telemetry.batteryPercent < 10) return 'high' as const
  if (telemetry.traffic === 'blocked') return 'medium' as const
  return undefined
}

export function requireAnomaly(context: DeliveryContext, nowMs: number) {
  if (context.severity === undefined || context.anomalyOpenedAtMs === undefined) {
    return Effect.fail(
      new ActionFailure({
        code: 'ANOMALY_MISSING',
        message: 'No unresolved anomaly to score',
      }),
    )
  }
  return Effect.succeed(scoreAnomaly(context.severity, context.anomalyOpenedAtMs, nowMs))
}
