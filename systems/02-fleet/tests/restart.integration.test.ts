import { type ColdChainDrillRequest, FleetRoutes } from '@openwizard/fleet-shared'
import { describe, expect, it } from 'vitest'
import { compose } from './fixtures/compose'
import { durableVersion } from './fixtures/durable'
import { fleetEnv } from './fixtures/env'
import { parseDashboard, request, waitForHealth } from './fixtures/http'

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} was missing from the dispatch projection`)
  return value
}

async function waitForScore(deliveryId: string, minimum: number): Promise<number> {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const result = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    const score = parseDashboard(result.body).escalations.find(
      (item) => item.deliveryId === deliveryId,
    )?.score
    if (score !== undefined && score >= minimum) return score
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Delivery ${deliveryId} did not reach escalation score ${minimum}`)
}

describe.skipIf(!fleetEnv.integration)('fleet restart persistence', () => {
  it('resumes an active cold-chain procedure after an API restart', async () => {
    const before = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    expect(before.status).toBe(200)
    const beforeDashboard = parseDashboard(before.body)
    const delivery = required(
      beforeDashboard.deliveries.find((candidate) => candidate.id === fleetEnv.deliveryId),
      'primary delivery',
    )
    const vehicleId = required(delivery.vehicleId, 'primary vehicle')
    const drill: ColdChainDrillRequest = {
      deliveryId: delivery.id,
      vehicleId,
      tempC: 12,
      commandId: `fleet-qa-restart-${Date.now()}`,
    }

    const triggered = await request(FleetRoutes.coldChainDrill, {
      method: 'POST',
      token: fleetEnv.simulatorToken,
      body: drill,
    })
    expect(triggered.status).toBe(200)

    const active = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    expect(active.status).toBe(200)
    const activeDashboard = parseDashboard(active.body)
    expect(activeDashboard.escalations.some((item) => item.deliveryId === delivery.id)).toBe(true)
    expect(
      required(
        activeDashboard.deliveries.find((candidate) => candidate.id === delivery.id),
        'active delivery',
      ).procedure.some((item) => item.status === 'active'),
    ).toBe(true)

    await compose('restart', 'fleet-api')
    await waitForHealth()

    const after = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    expect(after.status).toBe(200)
    const afterDashboard = parseDashboard(after.body)
    const resumed = required(
      afterDashboard.deliveries.find((candidate) => candidate.id === delivery.id),
      'resumed delivery',
    )
    expect(afterDashboard.cursor).toBeGreaterThanOrEqual(activeDashboard.cursor)
    expect(afterDashboard.escalations.some((item) => item.deliveryId === delivery.id)).toBe(true)
    expect(resumed.procedure.some((item) => item.status === 'active')).toBe(true)
    expect(resumed.version).toEqual(await durableVersion(afterDashboard.tenant.id, resumed.id))

    const intervention = await request(
      FleetRoutes.intervention.replace(':id', encodeURIComponent(resumed.id)),
      {
        method: 'POST',
        token: fleetEnv.dispatchToken,
        body: {
          action: 'hold',
          reason: 'restart CAS proof',
          commandId: `fleet-qa-restart-cas-${Date.now()}`,
          expectedVersion: resumed.version,
        },
      },
    )
    expect(intervention.status).toBe(200)
    expect(await waitForScore(delivery.id, 8)).toBeGreaterThanOrEqual(8)
  })
})
