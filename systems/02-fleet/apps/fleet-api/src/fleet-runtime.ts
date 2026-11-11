import { randomUUID } from 'node:crypto'
import type { DurableStore } from '@openwizard/durable/store'
import type {
  DeliverySignal,
  InterventionRequest,
  VehicleTelemetry,
  Viewer,
} from '@openwizard/fleet-shared'
import { Clock, Effect, Layer, ManagedRuntime, Option } from 'effect'
import type { FleetRepositoryShape } from './database/index.js'
import { DeliveryEffects } from './delivery-effects.js'
import { ActionFailure } from './delivery-model.js'
import { type DeliveryWizard, makeDeliveryWizard } from './delivery-wizard.js'
import { makeDeliveryDispatchProjection } from './dispatch-projection.js'
import {
  dispatchDeliverySignal,
  dispatchIntervention,
  type FleetDurableResult,
  initializeDeliveryHost,
} from './durable-commands.js'
import { makeWizardClock, makeWizardScheduler } from './runtime-environment.js'
import { createDeliveryRuntimeRegistry } from './runtime-registry.js'

type RuntimeSignal =
  | { readonly kind: 'delivery'; readonly request: DeliverySignal; readonly viewer: Viewer }
  | { readonly kind: 'telemetry'; readonly telemetry: VehicleTelemetry }

export function makeFleetRuntime(
  repository: FleetRepositoryShape,
  durableStore: DurableStore,
  effectClock: Clock.Clock,
) {
  const clock = makeWizardClock(effectClock)
  const scheduler = makeWizardScheduler()
  const deliveryEffects = Layer.succeed(DeliveryEffects, {
    perform: (command) =>
      Effect.gen(function* () {
        const recordedAtMs = yield* Clock.currentTimeMillis
        yield* repository
          .appendEvent({
            tenantId: command.tenantId,
            deliveryId: command.deliveryId,
            eventId: command.idempotencyKey,
            type: command.action,
            payload: command,
            occurredAtMs: recordedAtMs,
          })
          .pipe(
            Effect.mapError(
              () =>
                new ActionFailure({
                  code: 'ACTION_PERSISTENCE_FAILED',
                  message: 'Delivery action could not be persisted',
                }),
            ),
          )
        return { action: command.action, recordedAtMs }
      }),
  })
  const runtime = ManagedRuntime.make(
    Layer.merge(deliveryEffects, Layer.succeed(Clock.Clock, effectClock)),
  )
  const wizard = makeDeliveryWizard(runtime)
  const projection = makeDeliveryDispatchProjection(wizard)
  const registry = createDeliveryRuntimeRegistry<
    DeliveryWizard,
    RuntimeSignal,
    InterventionRequest,
    Viewer,
    FleetDurableResult,
    FleetDurableResult
  >({
    wizard,
    store: durableStore,
    scheduler,
    clock,
    ownerId: process.env.FLEET_OWNER_ID?.trim() || `fleet-${randomUUID()}`,
    repository: {
      listActiveRuns: () => Effect.runPromise(repository.listActiveRuns()),
      hasDelivery: (tenantId, deliveryId) =>
        Effect.runPromise(
          repository
            .findDeliveryOwner(tenantId, deliveryId)
            .pipe(Effect.map(Option.exists((owner) => owner === tenantId))),
        ),
    },
    createOptions: async (identity, host) => {
      const dashboard = await Effect.runPromise(repository.getDashboard(identity.tenantId))
      const delivery = dashboard.deliveries.find((item) => item.id === identity.deliveryId)
      const escalation = dashboard.escalations.find(
        (item) => item.deliveryId === identity.deliveryId,
      )
      return {
        ...host,
        context: {
          tenantId: identity.tenantId,
          deliveryId: identity.deliveryId,
          procedureState: 'assignment' as const,
          anomalyResolved: escalation === undefined,
          ...(delivery?.vehicleId === undefined ? {} : { vehicleId: delivery.vehicleId }),
          ...(delivery?.cargo.tempC === undefined ? {} : { currentTempC: delivery.cargo.tempC }),
          ...(escalation === undefined
            ? {}
            : {
                severity: escalation.severity,
                anomalyOpenedAtMs: Date.parse(escalation.createdAt),
                score: escalation.score,
                band: escalation.band,
                lastActionBand: null,
              }),
        },
      }
    },
    resumeOptions: (_identity, host) => host,
    initialize: initializeDeliveryHost,
    onTerminal: (_host, identity, result) => {
      const status =
        result.status === 'failed'
          ? ('failed' as const)
          : result.status === 'cancelled' ||
              (result.status === 'done' && result.output.state === 'cancellation')
            ? ('cancelled' as const)
            : ('completed' as const)
      return Effect.runPromise(
        repository.markRunTerminal({
          ...identity,
          status,
          terminalAtMs: clock.now(),
        }),
      )
    },
    signal: (host, _identity, signal) =>
      signal.kind === 'telemetry'
        ? host.send('telemetry', signal.telemetry, { eventId: signal.telemetry.commandId })
        : dispatchDeliverySignal(host, signal.request, signal.viewer, clock.now()),
    intervene: (host, _identity, request, viewer) =>
      dispatchIntervention(host, request, viewer, clock.now()),
  })
  return { clock, wizard, projection, registry, runtime }
}
