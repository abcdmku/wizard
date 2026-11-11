import { type DeliverySignal, FleetRoutes } from '@openwizard/fleet-shared'
import { describe, expect, it } from 'vitest'
import { fleetEnv } from './fixtures/env'
import { deliveryIdFrom, request } from './fixtures/http'

describe.skipIf(!fleetEnv.integration)('fleet auth and boundary failures', () => {
  it('rejects an unauthenticated dispatch request', async () => {
    const result = await request(FleetRoutes.dispatch)
    expect(result.status).toBe(401)
  })

  it('rejects malformed JSON before the intervention handler runs', async () => {
    const result = await request(
      FleetRoutes.intervention.replace(':id', encodeURIComponent(fleetEnv.deliveryId)),
      {
        method: 'POST',
        token: fleetEnv.dispatchToken,
        rawBody: '{"action":',
      },
    )
    expect(result.status).toBe(400)
  })

  it('does not let a dispatcher grant manager approval', async () => {
    const approval: DeliverySignal = {
      commandId: `fleet-qa-forbidden-approval-${Date.now()}`,
      signal: 'approval_granted',
    }
    const result = await request(
      FleetRoutes.deliverySignal.replace(':id', encodeURIComponent(fleetEnv.deliveryId)),
      {
        method: 'POST',
        token: fleetEnv.dispatchToken,
        body: approval,
      },
    )
    expect(result.status).toBe(403)
  })

  it('does not let a second bearer cross the first bearer boundary', async () => {
    const own = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    const foreign = await request(FleetRoutes.dispatch, { token: fleetEnv.secondaryToken })
    const ownId = deliveryIdFrom(own.body, fleetEnv.deliveryId)
    expect(deliveryIdFrom(foreign.body, fleetEnv.secondaryDeliveryId)).not.toBe(ownId)

    const attempt = await request(
      FleetRoutes.intervention.replace(':id', encodeURIComponent(ownId)),
      {
        method: 'POST',
        token: fleetEnv.secondaryToken,
        body: fleetEnv.interventionBody,
      },
    )
    expect(attempt.status).toBe(403)
  })
})
