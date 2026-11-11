import type { Dashboard, SeedCounts, VehicleTelemetry } from '@openwizard/fleet-shared'
import { Context, type Effect, type Option } from 'effect'
import type { FleetSeedData } from '../seed-data'
import type { FleetDatabaseError } from './errors'
import type { ActiveRunIdentity, TenantAuth } from './models'
import type { CommandStatus, TerminalStatus } from './schema'

export interface RecordTelemetryInput {
  readonly tenantId: string
  readonly vehicleId: string
  readonly telemetry: VehicleTelemetry
}

export interface AppendCommandInput {
  readonly tenantId: string
  readonly deliveryId: string
  readonly commandId: string
  readonly type: string
  readonly payload: unknown
  readonly status?: CommandStatus
  readonly occurredAtMs?: number
}

export interface AppendEventInput {
  readonly tenantId: string
  readonly deliveryId: string
  readonly eventId: string
  readonly type: string
  readonly payload: unknown
  readonly occurredAtMs?: number
}

export interface MarkRunTerminalInput {
  readonly tenantId: string
  readonly deliveryId: string
  readonly status: TerminalStatus
  readonly terminalAtMs?: number
}

export interface FleetRepositoryShape {
  readonly migrate: Effect.Effect<void, FleetDatabaseError>
  readonly seed: (data: FleetSeedData) => Effect.Effect<SeedCounts, FleetDatabaseError>
  readonly findTenantByToken: (
    token: string,
  ) => Effect.Effect<Option.Option<TenantAuth>, FleetDatabaseError>
  readonly getDashboard: (tenantId: string) => Effect.Effect<Dashboard, FleetDatabaseError>
  readonly findDeliveryOwner: (
    tenantId: string,
    deliveryId: string,
  ) => Effect.Effect<Option.Option<string>, FleetDatabaseError>
  readonly listActiveRuns: () => Effect.Effect<ReadonlyArray<ActiveRunIdentity>, FleetDatabaseError>
  readonly recordTelemetry: (input: RecordTelemetryInput) => Effect.Effect<void, FleetDatabaseError>
  readonly appendCommand: (input: AppendCommandInput) => Effect.Effect<boolean, FleetDatabaseError>
  readonly appendEvent: (input: AppendEventInput) => Effect.Effect<boolean, FleetDatabaseError>
  readonly markRunTerminal: (input: MarkRunTerminalInput) => Effect.Effect<void, FleetDatabaseError>
}

export class FleetRepository extends Context.Service<FleetRepository, FleetRepositoryShape>()(
  'fleet/database/FleetRepository',
) {}
