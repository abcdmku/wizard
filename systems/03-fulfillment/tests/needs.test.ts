import { fulfillmentWizard } from '@fulfillment/domain'
import { inspect } from '@openwizard/core/inspect'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import {
  flush,
  fraud,
  inventoryReserved,
  makeRun,
  NOW,
  ORDER_ID,
  paymentAuthorized,
  paymentCaptured,
  startThroughFraud,
  TENANT_ID,
} from './support/fulfillment'

const LATER = '2026-08-23T15:00:05.000Z'

function failed<Type extends string>(type: Type, code: string, reason: string, occurredAt = NOW) {
  return {
    type,
    eventId: `evt-${type}`,
    occurredAt,
    tenantId: TENANT_ID,
    orderId: ORDER_ID,
    data: { code, reason },
  }
}

describe('fulfillment hand-offs through needs', () => {
  it('describes every step and declares what each gate and failure step reads', () => {
    const manifest = inspect(fulfillmentWizard)
    const needs = (id: string) =>
      Object.keys(manifest.nodes.find((node) => node.id === id)?.needs ?? {})
    expect(manifest.description).toContain('Fulfils one order')
    expect(manifest.nodes.filter((node) => node.description === undefined)).toEqual([])
    expect(needs('readinessGate')).toEqual(['payment', 'inventory', 'readinessJoin'])
    expect(needs('failReadiness')).toEqual(['payment', 'inventory'])
    expect(needs('failFraudReview')).toEqual(['decision'])
    expect(needs('requestPaymentCapture')).toEqual(['authorization'])
    expect(needs('paymentCaptureGate')).toEqual(['capture'])
    expect(needs('requestShipment')).toEqual(['reservation'])
    expect(needs('shipmentGate')).toEqual(['shipment'])
    expect(needs('complete')).toEqual(['shipment'])
    expect(manifest.warnings.map((warning) => warning.code)).toEqual(['MULTIPLE_SINKS'])
  })

  it('fails readiness with the reason the payment partner gave', async () => {
    const run = makeRun([])
    await run.start()
    await flush()
    await run.send(
      'payment.authorization.failed',
      failed('payment.authorization.failed', 'card_declined', 'The card was declined'),
    )
    await run.send('inventory.reservation.succeeded', inventoryReserved())
    await flush()

    const state = run.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.failReadiness.error).toMatchObject({ message: 'The card was declined' })
    expect(state.context.lastFailure).toMatchObject({
      code: 'card_declined',
      operation: 'payment.authorization',
    })
    expect(state.steps.waitFraudReview.status).not.toBe('active')
    run.dispose()
  })

  it('reports the later failure when both readiness branches fail', async () => {
    const run = makeRun([])
    await run.start()
    await flush()
    await run.send(
      'inventory.reservation.failed',
      failed('inventory.reservation.failed', 'out_of_stock', 'A line is out of stock'),
    )
    await run.send(
      'payment.authorization.failed',
      failed('payment.authorization.failed', 'card_declined', 'The card was declined', LATER),
    )
    await flush()

    const state = run.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.failReadiness.error).toMatchObject({ message: 'The card was declined' })
    expect(state.context.lastFailure).toMatchObject({ code: 'card_declined' })
    run.dispose()
  })

  it('reports a timeout over a partner failure that arrived before it', async () => {
    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const run = makeRun([], { scheduler })
    await run.start()
    await flush()
    await run.send(
      'payment.authorization.failed',
      failed('payment.authorization.failed', 'card_declined', 'The card was declined'),
    )
    await flush()
    scheduler.advance(2 * 60 * 1000)
    await flush()

    const state = run.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.failReadiness.error).toMatchObject({
      message: 'Inventory reservation timed out',
    })
    expect(state.context.lastFailure).toMatchObject({ code: 'INVENTORY_RESERVATION_TIMEOUT' })
    run.dispose()
  })

  it('fails the fraud review with the rejection, and with the timeout when nobody answers', async () => {
    const rejected = makeRun([])
    await startThroughFraud(rejected)
    await rejected.send('fraud.reviewed', fraud('reject'))
    await flush()
    expect(rejected.getState().steps.failFraudReview.error).toMatchObject({
      message: 'An operator rejected the fraud review',
    })
    rejected.dispose()

    const scheduler = createTestScheduler({ now: Date.parse(NOW) })
    const ignored = makeRun([], { scheduler })
    await startThroughFraud(ignored)
    scheduler.advance(15 * 60 * 1000)
    await flush()
    expect(ignored.getState().steps.failFraudReview.error).toMatchObject({
      message: 'Fraud review timed out',
    })
    ignored.dispose()
  })

  it('captures with the authorization id and ships with the reservation id from needs', async () => {
    const calls: string[] = []
    const run = makeRun(calls)
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()
    expect(run.getState().steps.waitPaymentAuthorization.output).toEqual(paymentAuthorized())
    expect(calls).toContain(`capture:order:${ORDER_ID}:capture-payment`)

    await run.send(
      'payment.capture.failed',
      failed('payment.capture.failed', 'capture_refused', 'The capture was refused'),
    )
    await flush()
    const state = run.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.failPaymentCapture.error).toMatchObject({
      message: 'The capture was refused',
    })
    expect(state.steps.requestShipment.status).not.toBe('done')
    run.dispose()
  })

  it('fails the shipment with the reason the carrier gave', async () => {
    const run = makeRun([])
    await startThroughFraud(run)
    await run.send('fraud.reviewed', fraud('approve'))
    await flush()
    await run.send('payment.capture.succeeded', paymentCaptured())
    await flush()
    await run.send(
      'shipping.shipment.failed',
      failed('shipping.shipment.failed', 'address_invalid', 'The address is not deliverable'),
    )
    await flush()

    const state = run.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.failShipment.error).toMatchObject({
      message: 'The address is not deliverable',
    })
    expect(state.steps.complete.status).not.toBe('done')
    run.dispose()
  })
})
