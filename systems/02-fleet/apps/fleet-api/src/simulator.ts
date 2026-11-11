import {
  type ColdChainDrillRequest,
  ColdChainDrillRequestSchema,
  type Position,
  type VehicleTelemetry,
  VehicleTelemetrySchema,
} from '@openwizard/fleet-shared'
import { Clock, Effect, type Fiber, Ref, Schedule, Schema, type Scope } from 'effect'
import { FleetSeedIds } from './seed-data.js'

type Traffic = VehicleTelemetry['traffic']
type VehicleFault = Exclude<VehicleTelemetry['fault'], undefined>

export interface TelemetrySink<Error = never> {
  readonly publish: (
    tenantId: string,
    vehicleId: string,
    telemetry: VehicleTelemetry,
  ) => Effect.Effect<void, Error>
}

export interface ScheduledFault extends VehicleFault {
  readonly tick: number
}

export interface VehicleSimulation {
  readonly tenantId: string
  readonly vehicleId: string
  readonly route: ReadonlyArray<Position>
  readonly initialBatteryPercent: number
  readonly batteryDrainPerTick: number
  readonly temperaturesC: ReadonlyArray<number>
  readonly traffic: ReadonlyArray<Traffic>
  readonly faults: ReadonlyArray<ScheduledFault>
}

export interface ColdChainVehicleState {
  readonly position: Position
  readonly batteryPercent: number
  readonly traffic: Traffic
}

export interface SimulatorHandle<Error> {
  readonly fibers: ReadonlyArray<Fiber.Fiber<number, Error>>
}

const decodeTelemetry = Schema.decodeUnknownSync(VehicleTelemetrySchema)
const decodeDrill = Schema.decodeUnknownSync(ColdChainDrillRequestSchema)

const atTick = <Value>(values: ReadonlyArray<Value>, tick: number, fallback: Value): Value =>
  values[tick % Math.max(values.length, 1)] ?? fallback

const normalizedTick = (tick: number): number =>
  Number.isFinite(tick) && tick > 0 ? Math.floor(tick) : 0

const batteryAt = (simulation: VehicleSimulation, tick: number): number =>
  Math.max(
    0,
    Math.min(100, simulation.initialBatteryPercent - tick * simulation.batteryDrainPerTick),
  )

export const telemetryForTick = (
  simulation: VehicleSimulation,
  tickInput: number,
  capturedAt: number,
): VehicleTelemetry => {
  const tick = normalizedTick(tickInput)
  const position = atTick(simulation.route, tick, { x: 0, y: 0, heading: 0 })
  const tempC = atTick(simulation.temperaturesC, tick, 3)
  const traffic = atTick(simulation.traffic, tick, 'clear')
  const fault = simulation.faults.find((candidate) => candidate.tick === tick)
  const common = {
    commandId: `${simulation.vehicleId}:telemetry:${capturedAt}:${tick}`,
    capturedAt,
    position,
    batteryPercent: batteryAt(simulation, tick),
    tempC,
    traffic,
  }

  return decodeTelemetry(
    fault === undefined
      ? common
      : {
          ...common,
          fault: { code: fault.code, severity: fault.severity, detail: fault.detail },
        },
  )
}

export const defaultTelemetrySchedule = Schedule.spaced('5 seconds')

export const simulateVehicle = <Error>(
  sink: TelemetrySink<Error>,
  simulation: VehicleSimulation,
  schedule: Schedule.Schedule<number> = defaultTelemetrySchedule,
): Effect.Effect<number, Error> =>
  Effect.gen(function* () {
    const tickRef = yield* Ref.make(0)
    const publish = Effect.gen(function* () {
      const tick = yield* Ref.getAndUpdate(tickRef, (current) => current + 1)
      const capturedAt = yield* Clock.currentTimeMillis
      yield* sink.publish(
        simulation.tenantId,
        simulation.vehicleId,
        telemetryForTick(simulation, tick, capturedAt),
      )
    })

    return yield* Effect.repeat(publish, schedule)
  })

export const startFleetSimulator = <Error>(
  sink: TelemetrySink<Error>,
  simulations: ReadonlyArray<VehicleSimulation> = demoVehicleSimulations,
  schedule: Schedule.Schedule<number> = defaultTelemetrySchedule,
): Effect.Effect<SimulatorHandle<Error>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const fibers = yield* Effect.forEach(
      simulations,
      (simulation) => simulateVehicle(sink, simulation, schedule).pipe(Effect.forkScoped),
      { concurrency: 'unbounded' },
    )
    return { fibers }
  })

export const coldChainBreachTelemetry = (
  requestInput: ColdChainDrillRequest,
  state: ColdChainVehicleState,
  capturedAt: number,
): VehicleTelemetry => {
  const request = decodeDrill(requestInput)
  return decodeTelemetry({
    commandId: request.commandId,
    capturedAt,
    position: state.position,
    batteryPercent: state.batteryPercent,
    tempC: request.tempC,
    traffic: state.traffic,
    fault: {
      code: 'COLD_CHAIN_BREACH',
      severity: 'critical',
      detail: `Delivery ${request.deliveryId} measured ${request.tempC} C`,
    },
  })
}

export const runColdChainBreachDrill = <Error>(
  sink: TelemetrySink<Error>,
  tenantId: string,
  request: ColdChainDrillRequest,
  state: ColdChainVehicleState,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const capturedAt = yield* Clock.currentTimeMillis
    yield* sink.publish(
      tenantId,
      request.vehicleId,
      coldChainBreachTelemetry(request, state, capturedAt),
    )
  })

export const demoVehicleSimulations: ReadonlyArray<VehicleSimulation> = [
  {
    tenantId: FleetSeedIds.lakeshoreTenant,
    vehicleId: FleetSeedIds.lakeshorePrimaryVehicle,
    route: [
      { x: 18, y: 64, heading: 92 },
      { x: 24, y: 64, heading: 92 },
      { x: 30, y: 62, heading: 104 },
      { x: 35, y: 58, heading: 124 },
    ],
    initialBatteryPercent: 86,
    batteryDrainPerTick: 0.25,
    temperaturesC: [3.1, 3.2, 3.4, 6.8],
    traffic: ['clear', 'moderate', 'heavy', 'blocked'],
    faults: [
      {
        tick: 3,
        code: 'REFRIGERATION_HIGH_TEMP',
        severity: 'critical',
        detail: 'Cargo temperature is above the configured maximum',
      },
    ],
  },
  {
    tenantId: FleetSeedIds.lakeshoreTenant,
    vehicleId: FleetSeedIds.lakeshoreReserveVehicle,
    route: [
      { x: 34, y: 72, heading: 180 },
      { x: 34, y: 68, heading: 180 },
    ],
    initialBatteryPercent: 97,
    batteryDrainPerTick: 0.1,
    temperaturesC: [3, 3.1],
    traffic: ['clear', 'clear'],
    faults: [],
  },
  {
    tenantId: FleetSeedIds.redwoodTenant,
    vehicleId: FleetSeedIds.redwoodPrimaryVehicle,
    route: [
      { x: 72, y: 38, heading: 248 },
      { x: 68, y: 35, heading: 236 },
      { x: 63, y: 31, heading: 230 },
    ],
    initialBatteryPercent: 74,
    batteryDrainPerTick: 0.2,
    temperaturesC: [18, 18.2, 18.1],
    traffic: ['moderate', 'heavy', 'moderate'],
    faults: [],
  },
  {
    tenantId: FleetSeedIds.redwoodTenant,
    vehicleId: FleetSeedIds.redwoodReserveVehicle,
    route: [
      { x: 60, y: 24, heading: 12 },
      { x: 62, y: 28, heading: 24 },
    ],
    initialBatteryPercent: 91,
    batteryDrainPerTick: 0.1,
    temperaturesC: [19, 19.1],
    traffic: ['clear', 'moderate'],
    faults: [],
  },
]
