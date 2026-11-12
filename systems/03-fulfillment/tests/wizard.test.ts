import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import {
  flush,
  fraud,
  inventoryReserved,
  makeRun,
  NOW,
  ORDER_ID,
  OTHER_ORDER_ID,
  paymentAuthorized,
  paymentCaptured,
  shipmentSucceeded,
  startThroughFraud,
} from './support/fulfillment'

describe('production fulfillment wizard', () => {
  it('runs parallel partner branches, joins, captures, and waits for shipment', async () => {
    const calls: string[] = []
    const run = makeRun(calls)
    await run.start()
    await flush()
    expect(calls).toEqual([
      `authorize:order:${ORDER_ID}:authorize-payment`,
      `reserve:order:${ORDER_ID}:reserve-inventory`,
    ])

    await expect(
      run.send('payment.authorization.succeeded', paymentAuthorized()),
    ).resolves.toMatchObject({
      ok: true,
    })
    await expect(
      run.send('inventory.reservation.succeeded', inventoryReserved()),
    ).resolves.toMatchObject({
      ok: true,
    })
    await flush()
    expect(run.getState().steps.waitFraudReview.status).toBe('active')
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()
    expect(calls).toContain(`capture:order:${ORDER_ID}:capture-payment`)

    await run.send('payment.capture.succeeded', paymentCaptured())
    await flush()
    expect(calls).toContain(`shipment:order:${ORDER_ID}:create-shipment`)
    await run.send('shipping.shipment.succeeded', shipmentSucceeded())
    await flush()

    expect(run.getState().status).toBe('done')
    expect(run.getState().context.shipment.trackingNumber).toBe('TRACK-1')
    expect(await run.awaitResult()).toMatchObject({
      status: 'done',
      output: { shipmentId: 'shipment-1' },
    })
    run.dispose()
  })

  it('buffers an early carrier event and drops an event for another order', async () => {
    const calls: string[] = []
    const run = makeRun(calls)
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()
    await run.send('shipping.shipment.succeeded', shipmentSucceeded())
    const dropped = await run.send('shipping.shipment.succeeded', {
      ...shipmentSucceeded(),
      eventId: 'evt-other-order',
      orderId: OTHER_ORDER_ID,
    })
    expect(dropped).toMatchObject({ ok: false, reason: 'dropped' })
    await run.send('payment.capture.succeeded', paymentCaptured())
    await flush()
    expect(run.getState().status).toBe('done')
    run.dispose()
  })

  it('compensates authorization and inventory after a fraud rejection', async () => {
    const calls: string[] = []
    const run = makeRun(calls)
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('reject'))
    await flush()
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    run.dispose()
  })

  it('cancels an active order and reverses completed partner work', async () => {
    const calls: string[] = []
    const run = makeRun(calls)
    await startThroughFraud(run)

    await run.send('order.cancelled', {
      orderId: ORDER_ID,
      reason: 'customer requested cancellation',
      cancelledBy: 'customer-alice',
      cancelledAt: NOW,
    })
    await flush()

    expect(run.getState().status).toBe('cancelled')
    expect(calls).toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    run.dispose()
  })

  it('rejects malformed known payloads without moving the active wait', async () => {
    const run = makeRun([])
    await startThroughFraud(run)
    const malformed: unknown = { orderId: ORDER_ID, decision: 'approve' }
    const result = await run.send('fraud.reviewed', malformed)
    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(run.getState().steps.waitFraudReview.status).toBe('active')
    run.dispose()
  })

  it('exhausts capture retries with exponential backoff and compensates prior work', async () => {
    const calls: string[] = []
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun(calls, { captureFails: true, scheduler })
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()

    expect(calls.filter((call) => call.startsWith('capture:'))).toHaveLength(1)
    scheduler.advance(200)
    await flush()
    scheduler.advance(400)
    await flush()
    scheduler.advance(800)
    await flush()

    expect(calls.filter((call) => call.startsWith('capture:'))).toHaveLength(4)
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    expect(await run.awaitResult()).toMatchObject({ status: 'failed' })
    run.dispose()
  })

  it('fails readiness when authorization confirmation times out', async () => {
    const calls: string[] = []
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun(calls, { scheduler })
    await run.start()
    await flush()
    await run.send('inventory.reservation.succeeded', inventoryReserved())
    await flush()

    scheduler.advance(2 * 60 * 1000)
    await flush()

    expect(run.getState().context.paymentAuthorization.state).toBe('timed_out')
    expect(run.getState().context.inventoryReservation.state).toBe('reserved')
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    expect(calls).not.toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    run.dispose()
  })

  it('fails readiness when inventory confirmation times out', async () => {
    const calls: string[] = []
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun(calls, { scheduler })
    await run.start()
    await flush()
    await run.send('payment.authorization.succeeded', paymentAuthorized())
    await flush()

    scheduler.advance(2 * 60 * 1000)
    await flush()

    expect(run.getState().context.paymentAuthorization.state).toBe('authorized')
    expect(run.getState().context.inventoryReservation.state).toBe('timed_out')
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    expect(calls).not.toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    run.dispose()
  })

  it('times out capture and compensates authorization and inventory', async () => {
    const calls: string[] = []
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun(calls, { scheduler })
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()

    scheduler.advance(2 * 60 * 1000)
    await flush()

    expect(run.getState().context.paymentCapture.state).toBe('timed_out')
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    run.dispose()
  })

  it('times out fraud review and compensates readiness reservations', async () => {
    const calls: string[] = []
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun(calls, { scheduler })
    await startThroughFraud(run)

    scheduler.advance(15 * 60 * 1000)
    await flush()

    expect(run.getState().context.fraud.state).toBe('timed_out')
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`void:auth-1:order:${ORDER_ID}:void-authorization`)
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    run.dispose()
  })

  it('times out shipment and reverses shipment, capture, and inventory', async () => {
    const calls: string[] = []
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun(calls, { scheduler })
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()
    await run.send('payment.capture.succeeded', paymentCaptured())
    await flush()

    scheduler.advance(5 * 60 * 1000)
    await flush()

    expect(run.getState().context.shipment.state).toBe('timed_out')
    expect(run.getState().status).toBe('failed')
    expect(calls).toContain(`cancel-shipment:shipment-request-1:order:${ORDER_ID}:cancel-shipment`)
    expect(calls).toContain(`refund:capture-1:order:${ORDER_ID}:refund-payment`)
    expect(calls).toContain(`release:reservation-1:order:${ORDER_ID}:release-inventory`)
    run.dispose()
  })
})
