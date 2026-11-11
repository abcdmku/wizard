import {
  FleetRoutes,
  type InterventionRequest,
  InterventionResponseSchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { compose } from './fixtures/compose'
import { durableCommandResult, durableVersion } from './fixtures/durable'
import { fleetEnv } from './fixtures/env'
import { deliveryIdFrom, parseDashboard, request, waitForHealth } from './fixtures/http'

const decodeResponse = Schema.decodeUnknownSync(InterventionResponseSchema)

describe.skipIf(!fleetEnv.integration)('fleet replay after restart', () => {
  it('returns the saved command result without advancing the durable version', async () => {
    const dispatch = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    const deliveryId = deliveryIdFrom(dispatch.body, fleetEnv.deliveryId)
    const dashboard = parseDashboard(
      (await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })).body,
    )
    const command: InterventionRequest = {
      action: 'hold',
      reason: 'replay after restart',
      commandId: `fleet-qa-replay-${Date.now()}`,
    }
    const path = FleetRoutes.intervention.replace(':id', encodeURIComponent(deliveryId))
    const accepted = await request(path, {
      method: 'POST',
      token: fleetEnv.dispatchToken,
      body: command,
    })
    expect(accepted.status).toBe(200)
    const acceptedBody = decodeResponse(accepted.body)
    expect(acceptedBody.accepted).toBe(true)
    const savedResult = await durableCommandResult(
      dashboard.tenant.id,
      deliveryId,
      command.commandId,
    )

    await compose('restart', 'fleet-api')
    await waitForHealth()
    const beforeReplay = await durableVersion(dashboard.tenant.id, deliveryId)

    const replayed = await request(path, {
      method: 'POST',
      token: fleetEnv.dispatchToken,
      body: command,
    })
    expect(replayed.status).toBe(200)
    expect(decodeResponse(replayed.body).accepted).toBe(true)
    expect(await durableCommandResult(dashboard.tenant.id, deliveryId, command.commandId)).toBe(
      savedResult,
    )
    expect(await durableVersion(dashboard.tenant.id, deliveryId)).toEqual(beforeReplay)
  })
})
