import { FleetRoutes } from '@openwizard/fleet-shared'
import { describe, expect, it } from 'vitest'
import { compose } from './fixtures/compose'
import { fleetEnv } from './fixtures/env'
import { deliveryIdFrom, request } from './fixtures/http'

describe.skipIf(!fleetEnv.integration)('fleet real Postgres path', () => {
  it('has a healthy Postgres container behind the API and seeded rows', async () => {
    const ready = await compose(
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-U',
      'fleet',
      '-d',
      'fleet',
    )
    expect(ready).toContain('accepting connections')

    const result = await request(FleetRoutes.dispatch, { token: fleetEnv.dispatchToken })
    expect(result.status).toBe(200)
    expect(deliveryIdFrom(result.body, fleetEnv.deliveryId)).toBe(fleetEnv.deliveryId)
  })
})
