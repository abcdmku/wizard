import { fulfillmentWizard } from '@fulfillment/domain'
import { createMemoryStore } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import {
  createGateway,
  flush,
  fraud,
  inventoryReserved,
  makeRun,
  NOW,
  paymentAuthorized,
  paymentCaptured,
  shipmentSucceeded,
} from './support/fulfillment'

describe('fulfillment restart recovery', () => {
  it('resumes a persisted fraud wait with a new epoch and the same side-effect keys', async () => {
    const store = createMemoryStore()
    const calls: string[] = []
    const run = makeRun(calls, { store, key: 'acme/order-1' })
    await run.start()
    await flush()
    await run.send('payment.authorization.succeeded', paymentAuthorized())
    await run.send('inventory.reservation.succeeded', inventoryReserved())
    await flush()
    await run.save()
    const saved = await store.get('acme/order-1')
    if (saved === null) throw new Error('restart fixture did not persist a snapshot')
    expect(run.epoch).toBe(0)
    run.dispose()

    const resumedCalls: string[] = []
    const resumed = fulfillmentWizard.resume(saved, {
      store,
      key: 'acme/order-1',
      deps: { gateway: createGateway(resumedCalls), now: () => NOW },
      scheduler: createTestScheduler({ now: Date.parse(NOW) }),
    })
    expect(resumed.epoch).toBe(1)
    expect(resumed.getState().steps.waitFraudReview.status).toBe('active')

    await resumed.send('fraud.reviewed', fraud('approve'))
    await flush()
    await resumed.send('payment.capture.succeeded', paymentCaptured())
    await flush()
    await resumed.send('shipping.shipment.succeeded', shipmentSucceeded())
    await flush()
    expect(resumed.getState().status).toBe('done')
    expect(resumedCalls).toContain(
      'capture:order:c56a4180-65aa-42ec-a945-5fd21dec0538:capture-payment',
    )
    expect(resumedCalls).toContain(
      'shipment:order:c56a4180-65aa-42ec-a945-5fd21dec0538:create-shipment',
    )
    resumed.dispose()
  })

  it('rejects a snapshot from another wizard before any dependency runs', async () => {
    const store = createMemoryStore()
    const run = makeRun([], { store, key: 'acme/order-1' })
    await run.start()
    await run.save()
    const saved = await store.get('acme/order-1')
    if (saved === null || typeof saved !== 'object' || saved === null) {
      throw new Error('restart fixture did not persist a snapshot')
    }
    const alien = { ...saved, wizard: { name: 'other-wizard', version: 1 } }
    expect(() =>
      fulfillmentWizard.resume(alien, {
        deps: { gateway: createGateway([]), now: () => NOW },
      }),
    ).toThrow(/SNAPSHOT_INCOMPATIBLE|wizard/i)
    run.dispose()
  })
})
