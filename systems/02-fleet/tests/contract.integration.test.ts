import { FleetRoutes } from '@openwizard/fleet-shared'
import { describe, expect, it } from 'vitest'
import { fleetEnv } from './fixtures/env'
import { deliveryIdFrom, openStream, parseDashboard, request } from './fixtures/http'

const integration = fleetEnv.integration

describe.skipIf(!integration)('fleet REST/live contract', () => {
  it('returns only the bearer-scoped dispatch projection', async () => {
    const result = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    expect(result.status).toBe(200)
    const deliveryId = deliveryIdFrom(result.body, fleetEnv.deliveryId)
    expect(deliveryId).toBe(fleetEnv.deliveryId)
    expect(
      parseDashboard(result.body).deliveries.find((delivery) => delivery.id === deliveryId)
        ?.version,
    ).toBeDefined()
    expect(result.text).not.toContain('tenantId')
    expect(result.text).not.toContain('scope')
  })

  it('accepts a delivery intervention through the live API', async () => {
    const dispatch = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    const deliveryId = deliveryIdFrom(dispatch.body, fleetEnv.deliveryId)
    const result = await request(
      FleetRoutes.intervention.replace(':id', encodeURIComponent(deliveryId)),
      {
        method: 'POST',
        token: fleetEnv.dispatchToken,
        body: fleetEnv.interventionBody,
      },
    )
    expect(result.status).toBe(200)
  })

  it('opens the SSE stream with the same bearer contract', async () => {
    const result = await openStream(FleetRoutes.dispatchLive, { token: fleetEnv.dispatchToken })
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toContain('text/event-stream')
    expect(result.chunk).toContain('data:')
    expect(result.chunk).toContain('"version"')
  })
})
