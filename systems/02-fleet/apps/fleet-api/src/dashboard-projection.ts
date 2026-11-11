import type { Dashboard, Delivery, FleetApiError, Viewer } from '@openwizard/fleet-shared'
import { Effect } from 'effect'
import type { DeliveryDispatchView } from './dispatch-projection'
import { scoreAnomaly } from './score-policy'

type LoadDashboard = (viewer: Viewer) => Effect.Effect<Dashboard, FleetApiError>
type VersionedDispatchView =
  | (Exclude<DeliveryDispatchView, null> & {
      readonly version: NonNullable<Delivery['version']>
    })
  | null
type ProjectDelivery = (
  viewer: Viewer,
  deliveryId: string,
) => Effect.Effect<VersionedDispatchView, FleetApiError>

export function makeProjectedDashboard(
  load: LoadDashboard,
  project: ProjectDelivery,
  now: () => number,
): LoadDashboard {
  return (viewer) =>
    Effect.gen(function* () {
      const dashboard = yield* load(viewer)
      const active = dashboard.deliveries.filter(
        (delivery) => delivery.status !== 'completed' && delivery.status !== 'cancelled',
      )
      const views = yield* Effect.forEach(active, (delivery) => project(viewer, delivery.id), {
        concurrency: 8,
      })
      const visible = new Map(
        views.flatMap((view) => (view === null ? [] : [[view.deliveryId, view] as const])),
      )
      const deliveries = dashboard.deliveries.map((delivery) => {
        const view = visible.get(delivery.id)
        if (view === undefined) return delivery
        const status: Delivery['status'] =
          view.procedureState === 'completion'
            ? 'completed'
            : view.procedureState === 'cancellation'
              ? 'cancelled'
              : view.anomalyResolved
                ? 'in_transit'
                : 'delayed'
        return {
          ...delivery,
          version: view.version,
          status,
          procedure: delivery.procedure.map((item) =>
            item.status === 'active'
              ? { ...item, detail: `Wizard state: ${view.procedureState}` }
              : item,
          ),
        }
      })
      const retained = dashboard.escalations.filter((item) => {
        const view = visible.get(item.deliveryId)
        return view === undefined || !view.anomalyResolved
      })
      const escalations = [...retained]
      for (const view of visible.values()) {
        if (
          view.anomalyResolved ||
          view.severity === undefined ||
          view.anomalyOpenedAtMs === undefined
        )
          continue
        const score = scoreAnomaly(view.severity, view.anomalyOpenedAtMs, now())
        const index = escalations.findIndex((item) => item.deliveryId === view.deliveryId)
        const prior = index < 0 ? undefined : escalations[index]
        const escalation = {
          id: prior?.id ?? `runtime-${view.deliveryId}`,
          deliveryId: view.deliveryId,
          kind: prior?.kind ?? 'vehicle_anomaly',
          severity: score.severity,
          score: score.score,
          band: score.band,
          createdAt: prior?.createdAt ?? new Date(view.anomalyOpenedAtMs).toISOString(),
          title: prior?.title ?? 'Vehicle anomaly requires intervention',
          detail: prior?.detail ?? 'Live vehicle telemetry triggered the delivery procedure.',
          allowedActions: score.allowedActions,
        }
        if (index < 0) escalations.push(escalation)
        else escalations[index] = escalation
      }
      escalations.sort(
        (left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt),
      )
      return { ...dashboard, deliveries, escalations }
    })
}
