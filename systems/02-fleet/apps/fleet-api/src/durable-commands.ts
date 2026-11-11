import type {
  DurableCommandOptions,
  DurableCommandResult,
  DurableEventResult,
  DurableRunHost,
} from '@openwizard/durable'
import {
  CommandConflictError,
  type DeliverySignal,
  type FleetApiError,
  type InterventionRequest,
  MalformedRequestError,
  PersistenceError,
  type Viewer,
} from '@openwizard/fleet-shared'
import { Effect } from 'effect'
import type { DeliveryFlow } from './delivery-flow'
import type { DeliveryDurableCommands } from './runtime-registry'

export type FleetDurableResult = DurableCommandResult | DurableEventResult

export function acceptDurable(result: FleetDurableResult): Effect.Effect<void, FleetApiError> {
  const command = result.ok && 'result' in result ? result.result : result
  if (command.ok) return Effect.void
  if (command.code === 'CAS_CONFLICT' || command.code === 'DEDUPLICATE_CONFLICT') {
    return Effect.fail(
      new CommandConflictError({
        code: 'CAS_CONFLICT',
        message: 'The delivery changed before this command was applied',
      }),
    )
  }
  if (command.code === 'BOUNDARY_REJECTED') {
    return Effect.fail(
      new MalformedRequestError({
        code: 'MALFORMED_REQUEST',
        message: 'The delivery signal payload is invalid',
      }),
    )
  }
  if (!result.ok && !('reason' in result)) {
    return Effect.fail(
      new PersistenceError({
        code: 'PERSISTENCE_FAILED',
        message: `Durable command failed: ${command.code}`,
      }),
    )
  }
  return Effect.fail(new CommandConflictError({ code: 'CAS_CONFLICT', message: command.message }))
}

function commandOptions(request: DeliverySignal | InterventionRequest): DurableCommandOptions {
  return {
    commandId: request.commandId,
    digest: requestDigest(request),
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
  }
}

function requestDigest(request: DeliverySignal | InterventionRequest): string {
  const version =
    request.expectedVersion === undefined
      ? null
      : [request.expectedVersion.epoch, request.expectedVersion.seq]
  return 'action' in request
    ? `fleet:intervention:${JSON.stringify([request.action, request.reason ?? null, version])}`
    : `fleet:signal:${JSON.stringify([
        request.signal,
        request.vehicleId ?? null,
        request.note ?? null,
        version,
      ])}`
}

export function dispatchIntervention(
  host: DeliveryDurableCommands<DeliveryFlow>,
  request: InterventionRequest,
  viewer: Viewer,
  at: number,
): Promise<FleetDurableResult> {
  if (request.action === 'cancel') {
    return host.dispatch(
      { type: 'cancel', reason: request.reason ?? 'cancelled by operator' },
      commandOptions(request),
    )
  }
  return host.dispatch(
    {
      type: 'send',
      event: 'intervention',
      eventId: request.commandId,
      payload: {
        commandId: request.commandId,
        action: request.action,
        actorRole: viewer.role,
        at,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      },
    },
    commandOptions(request),
  )
}

export function dispatchDeliverySignal(
  host: DeliveryDurableCommands<DeliveryFlow>,
  request: DeliverySignal,
  viewer: Viewer,
  at: number,
): Promise<FleetDurableResult> {
  // User commands retain a version fence and payload digest; plain telemetry uses host.send.
  const options = commandOptions(request)
  switch (request.signal) {
    case 'assigned':
      return host.dispatch(
        {
          type: 'send',
          event: 'assigned',
          eventId: request.commandId,
          payload: { vehicleId: request.vehicleId, at },
        },
        options,
      )
    case 'pickup_confirmed':
      return host.dispatch(
        { type: 'send', event: 'pickupConfirmed', eventId: request.commandId, payload: { at } },
        options,
      )
    case 'arrived':
      return host.dispatch(
        { type: 'send', event: 'arrived', eventId: request.commandId, payload: { at } },
        options,
      )
    case 'anomaly_resolved':
      return host.dispatch(
        {
          type: 'send',
          event: 'anomalyResolved',
          eventId: request.commandId,
          payload: {
            commandId: request.commandId,
            at,
            ...(request.note === undefined ? {} : { note: request.note }),
          },
        },
        options,
      )
    case 'approval_granted':
    case 'approval_denied':
      return host.dispatch(
        {
          type: 'send',
          event: 'approval',
          eventId: request.commandId,
          payload: {
            commandId: request.commandId,
            approved: request.signal === 'approval_granted',
            actorRole: viewer.role,
            at,
            ...(request.note === undefined ? {} : { note: request.note }),
          },
        },
        options,
      )
    case 'cancelled':
      return host.dispatch(
        { type: 'cancel', reason: request.note ?? 'delivery cancelled' },
        {
          commandId: request.commandId,
          digest: requestDigest(request),
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion }),
        },
      )
  }
}

export async function initializeDeliveryHost(host: DurableRunHost<DeliveryFlow>): Promise<void> {
  const start = await host.dispatch({ type: 'start' }, { commandId: 'fleet:bootstrap:start' })
  if (!start.ok) throw new Error(`Durable start failed: ${start.code}`)
  const pickup = await host.send(
    'pickupConfirmed',
    { at: 0 },
    { eventId: 'fleet:bootstrap:pickup' },
  )
  if (!pickup.ok) throw new Error(`Durable pickup failed: ${pickup.code}`)
}
