import { boundary, defineProjection, type ProjectionOutput } from '@openwizard/core'
import type { Viewer } from '@openwizard/fleet-shared'
import type { DeliveryFlow } from './delivery-flow'

export function makeDeliveryDispatchProjection(flow: DeliveryFlow) {
  return defineProjection(flow, {
    scope: boundary.trusted<Viewer>(),
    select: ({ state, scope }) => {
      const context = state.context
      if (
        context.tenantId !== scope.tenantId ||
        (scope.role !== 'dispatcher' && scope.role !== 'manager')
      )
        return null
      return {
        deliveryId: context.deliveryId,
        procedureState: context.procedureState,
        anomalyResolved: context.anomalyResolved,
        ...(context.anomalyOpenedAtMs === undefined
          ? {}
          : { anomalyOpenedAtMs: context.anomalyOpenedAtMs }),
        ...(context.vehicleId === undefined ? {} : { vehicleId: context.vehicleId }),
        ...(context.severity === undefined ? {} : { severity: context.severity }),
        ...(context.score === undefined ? {} : { score: context.score }),
        ...(context.band === undefined ? {} : { band: context.band }),
      }
    },
  })
}

export type DeliveryDispatchProjection = ReturnType<typeof makeDeliveryDispatchProjection>
export type DeliveryDispatchView = ProjectionOutput<DeliveryDispatchProjection>
