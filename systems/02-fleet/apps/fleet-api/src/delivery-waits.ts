import type { HookArgs } from '@openwizard/core'
import type { EffectDeps } from '@openwizard/effect'
import type { VehicleTelemetry } from '@openwizard/fleet-shared'
import type { DeliveryEffects } from './delivery-effects'
import type {
  AnomalyResolvedEvent,
  ApprovalEvent,
  DeliveryContext,
  InterventionEvent,
  PickupConfirmedEvent,
} from './delivery-model'
import { telemetrySeverity } from './delivery-runtime'

export type DeliveryDeps = EffectDeps<DeliveryEffects>
type EventHookArgs<P, E extends string> = HookArgs<DeliveryContext, DeliveryDeps> & {
  readonly event: E
  readonly payload: P
}

// Each handler finishes its wait with the id of the step to run next. The context holds the
// anomaly the telemetry stream reports, because any of five waits can open or update it.

export const pickup = (args: EventHookArgs<PickupConfirmedEvent, 'pickupConfirmed'>) => {
  args.update({ procedureState: 'transit' })
  if (!args.context.anomalyResolved && args.context.severity !== undefined)
    return { done: 'scoreInitial' } as const
  return { done: 'transit' } as const
}

export const telemetry = (args: EventHookArgs<VehicleTelemetry, 'telemetry'>) => {
  const severity = telemetrySeverity(args.payload)
  if (severity === undefined) {
    args.update({
      currentTempC: args.payload.tempC,
      lastTelemetryAtMs: args.payload.capturedAt,
    })
    return { keep: true } as const
  }
  const isNew = args.context.anomalyResolved || args.context.severity === undefined
  args.update({
    currentTempC: args.payload.tempC,
    lastTelemetryAtMs: args.payload.capturedAt,
    severity,
    anomalyOpenedAtMs: isNew
      ? args.payload.capturedAt
      : (args.context.anomalyOpenedAtMs ?? args.payload.capturedAt),
    anomalyResolved: false,
    ...(isNew ? { lastActionBand: null } : {}),
  })
  return { done: isNew ? ('scoreInitial' as const) : ('rescore' as const) }
}

export const intervention = (args: EventHookArgs<InterventionEvent, 'intervention'>) => {
  if (args.payload.action === 'complete') return { done: 'completion' } as const
  if (args.payload.action === 'reroute') {
    args.update({ anomalyResolved: true, procedureState: 'transit', lastActionBand: null })
    return { done: 'postInterventionTransit' } as const
  }
  return { keep: true } as const
}

export const anomalyResolved = (args: EventHookArgs<AnomalyResolvedEvent, 'anomalyResolved'>) => {
  args.update({ anomalyResolved: true, procedureState: 'transit', lastActionBand: null })
  return { done: 'postInterventionTransit' } as const
}

export const approval = (args: EventHookArgs<ApprovalEvent, 'approval'>) => {
  if (args.payload.approved) {
    args.update({ procedureState: 'transit', anomalyResolved: true })
    return { done: 'postInterventionTransit' } as const
  }
  args.update({ procedureState: 'cancellation' })
  return { done: 'operatorCancelled' } as const
}
