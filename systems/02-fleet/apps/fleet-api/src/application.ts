import {
  CrossTenantError,
  DeliveryNotFoundError,
  type FleetApiError,
  MalformedRequestError,
  PersistenceError,
  type VehicleTelemetry,
  type Viewer,
} from '@openwizard/fleet-shared'
import { Clock, Effect, Layer, Option, Schedule, Stream } from 'effect'
import { makeProjectedDashboard } from './dashboard-projection.js'
import { FleetDurableStore, FleetRepository } from './database/index.js'
import { acceptDurable } from './durable-commands.js'
import { makeFleetRuntime } from './fleet-runtime.js'
import { FleetApplication } from './http-api.js'
import { fleetSeedData } from './seed-data.js'
import { runColdChainBreachDrill, startFleetSimulator } from './simulator.js'

function persistence(message: string): PersistenceError {
  return new PersistenceError({ code: 'PERSISTENCE_FAILED', message })
}

const makeApplication = Effect.gen(function* () {
  const repository = yield* FleetRepository
  const durableStore = yield* FleetDurableStore
  const effectClock = yield* Clock.Clock

  yield* repository.migrate.pipe(Effect.mapError(() => persistence('Database migration failed')))
  yield* repository
    .seed(fleetSeedData)
    .pipe(Effect.mapError(() => persistence('Database seed failed')))

  const { clock, projection, registry, runtime } = makeFleetRuntime(
    repository,
    durableStore,
    effectClock,
  )
  yield* Effect.tryPromise({
    try: () => registry.recover(),
    catch: () => persistence('Delivery runtime recovery failed'),
  })

  const owner = (viewer: Viewer, deliveryId: string): Effect.Effect<string, FleetApiError> =>
    Effect.gen(function* () {
      const result = yield* repository
        .findDeliveryOwner(viewer.tenantId, deliveryId)
        .pipe(Effect.mapError(() => persistence('Delivery lookup failed')))
      if (Option.isNone(result)) {
        return yield* Effect.fail(
          new DeliveryNotFoundError({
            code: 'DELIVERY_NOT_FOUND',
            message: 'Delivery not found',
          }),
        )
      }
      if (result.value !== viewer.tenantId) {
        return yield* Effect.fail(
          new CrossTenantError({
            code: 'CROSS_TENANT',
            message: 'The delivery belongs to another tenant',
          }),
        )
      }
      return result.value
    })

  const loadDashboard = (viewer: Viewer) =>
    repository
      .getDashboard(viewer.tenantId)
      .pipe(Effect.mapError(() => persistence('Dispatch dashboard could not be loaded')))
  const dashboard = makeProjectedDashboard(
    loadDashboard,
    (viewer, deliveryId) =>
      Effect.tryPromise({
        try: async () => {
          const host = await registry.get(viewer.tenantId, deliveryId)
          const projected = host.run.project(projection, viewer)
          return projected === null ? null : { ...projected, version: host.version }
        },
        catch: () => persistence('Delivery projection could not be loaded'),
      }),
    clock.now,
  )

  const recordCommand = (
    viewer: Viewer,
    deliveryId: string,
    commandId: string,
    type: string,
    payload: unknown,
  ) =>
    repository
      .appendCommand({
        tenantId: viewer.tenantId,
        deliveryId,
        commandId,
        type,
        payload,
      })
      .pipe(Effect.mapError(() => persistence('Command audit could not be persisted')))

  const ingestTelemetry = (viewer: Viewer, vehicleId: string, telemetry: VehicleTelemetry) =>
    Effect.gen(function* () {
      const current = yield* loadDashboard(viewer)
      const vehicle = current.vehicles.find((candidate) => candidate.id === vehicleId)
      if (vehicle === undefined) {
        return yield* Effect.fail(
          new DeliveryNotFoundError({
            code: 'VEHICLE_NOT_FOUND',
            message: 'Vehicle not found',
          }),
        )
      }
      yield* repository
        .recordTelemetry({
          tenantId: viewer.tenantId,
          vehicleId,
          telemetry,
        })
        .pipe(Effect.mapError(() => persistence('Telemetry could not be persisted')))
      const deliveryId = vehicle.activeDeliveryId
      if (deliveryId !== undefined) {
        const result = yield* Effect.tryPromise({
          try: () =>
            registry.signal(viewer.tenantId, deliveryId, {
              kind: 'telemetry',
              telemetry,
            }),
          catch: () => persistence('Telemetry delivery failed'),
        })
        yield* acceptDurable(result)
      }
      return { accepted: true as const }
    })

  yield* startFleetSimulator({
    publish: (tenantId, vehicleId, telemetry) =>
      ingestTelemetry({ tenantId, role: 'simulator' }, vehicleId, telemetry).pipe(Effect.asVoid),
  })

  const service = FleetApplication.of({
    ready: () => Effect.succeed(registry.isReady()),
    dashboard,
    subscribe: (viewer) =>
      Stream.fromEffectSchedule(
        dashboard(viewer).pipe(
          Effect.map((data) => ({
            cursor: data.cursor,
            type: 'snapshot' as const,
            data,
          })),
        ),
        Schedule.spaced('1 second'),
      ),
    intervene: (viewer, deliveryId, request) =>
      Effect.gen(function* () {
        yield* owner(viewer, deliveryId)
        const result = yield* Effect.tryPromise({
          try: () => registry.intervene(viewer.tenantId, deliveryId, request, viewer),
          catch: () => persistence('Intervention delivery failed'),
        })
        yield* acceptDurable(result)
        yield* recordCommand(viewer, deliveryId, request.commandId, request.action, request)
        return { accepted: true, dashboard: yield* dashboard(viewer) }
      }),
    signal: (viewer, deliveryId, request) =>
      Effect.gen(function* () {
        yield* owner(viewer, deliveryId)
        if (request.signal === 'assigned' && request.vehicleId === undefined) {
          return yield* Effect.fail(
            new MalformedRequestError({
              code: 'MALFORMED_REQUEST',
              message: 'Assigned signals require a vehicleId',
            }),
          )
        }
        const result = yield* Effect.tryPromise({
          try: () =>
            registry.signal(viewer.tenantId, deliveryId, {
              kind: 'delivery',
              request,
              viewer,
            }),
          catch: () => persistence('Delivery signal failed'),
        })
        yield* acceptDurable(result)
        yield* recordCommand(viewer, deliveryId, request.commandId, request.signal, request)
        return { accepted: true }
      }),
    telemetry: ingestTelemetry,
    coldChainDrill: (viewer, request) =>
      Effect.gen(function* () {
        const current = yield* loadDashboard(viewer)
        const vehicle = current.vehicles.find((candidate) => candidate.id === request.vehicleId)
        const delivery = current.deliveries.find((candidate) => candidate.id === request.deliveryId)
        const isBreach =
          delivery?.cargo.coldChain &&
          ((delivery.cargo.minC !== undefined && request.tempC < delivery.cargo.minC) ||
            (delivery.cargo.maxC !== undefined && request.tempC > delivery.cargo.maxC))
        if (vehicle === undefined || vehicle.activeDeliveryId !== request.deliveryId || !isBreach) {
          return yield* Effect.fail(
            new MalformedRequestError({
              code: 'MALFORMED_REQUEST',
              message:
                'The drill requires an assigned cold-chain delivery and an out-of-range temperature',
            }),
          )
        }
        yield* runColdChainBreachDrill(
          {
            publish: (_tenantId, vehicleId, telemetry) =>
              ingestTelemetry(viewer, vehicleId, telemetry).pipe(Effect.asVoid),
          },
          viewer.tenantId,
          request,
          { position: vehicle.position, batteryPercent: 80, traffic: 'blocked' },
        )
        return { accepted: true }
      }),
    seed: () =>
      repository.seed(fleetSeedData).pipe(
        Effect.map((counts) => ({ seeded: true as const, ...counts })),
        Effect.mapError(() => persistence('Fleet seed failed')),
      ),
  })
  return { registry, runtime, service }
})

export const FleetApplicationLive = Layer.effect(
  FleetApplication,
  Effect.acquireRelease(makeApplication, ({ registry, runtime }) =>
    Effect.promise(async () => {
      await registry.dispose()
      await runtime.dispose()
    }),
  ).pipe(Effect.map(({ service }) => service)),
)
