import { FleetRoutes, type InterventionRequest } from '@openwizard/fleet-shared'
import { describe, expect, it } from 'vitest'
import { fleetEnv } from './fixtures/env'
import { deliveryIdFrom, request } from './fixtures/http'

describe.skipIf(!fleetEnv.integration)('fleet command conflicts', () => {
  it('rejects a reused command id when the payload changes', async () => {
    const dispatch = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    const deliveryId = deliveryIdFrom(dispatch.body, fleetEnv.deliveryId)
    const commandId = `fleet-qa-duplicate-${Date.now()}`
    const first: InterventionRequest = {
      action: 'hold',
      reason: 'duplicate command first request',
      commandId,
    }
    const second: InterventionRequest = {
      action: 'hold',
      reason: 'duplicate command changed request',
      commandId,
    }

    const accepted = await request(
      FleetRoutes.intervention.replace(':id', encodeURIComponent(deliveryId)),
      { method: 'POST', token: fleetEnv.dispatchToken, body: first },
    )
    expect(accepted.status).toBe(200)

    const conflict = await request(
      FleetRoutes.intervention.replace(':id', encodeURIComponent(deliveryId)),
      { method: 'POST', token: fleetEnv.dispatchToken, body: second },
    )
    expect(conflict.status).toBe(409)
  })

  it('rejects a command sent with a stale durable version', async () => {
    const dispatch = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    const deliveryId = deliveryIdFrom(dispatch.body, fleetEnv.deliveryId)
    const advance: InterventionRequest = {
      action: 'hold',
      reason: 'advance durable version',
      commandId: `fleet-qa-version-advance-${Date.now()}`,
    }
    const stale: InterventionRequest = {
      action: 'hold',
      reason: 'stale durable version',
      commandId: `fleet-qa-version-stale-${Date.now()}`,
      expectedVersion: { epoch: 0, seq: 0 },
    }
    const path = FleetRoutes.intervention.replace(':id', encodeURIComponent(deliveryId))

    expect(
      (await request(path, { method: 'POST', token: fleetEnv.dispatchToken, body: advance }))
        .status,
    ).toBe(200)
    expect(
      (await request(path, { method: 'POST', token: fleetEnv.dispatchToken, body: stale })).status,
    ).toBe(409)
  })
})
