import { mappedFailure } from './failures'
import type { ReadinessSteps } from './readiness-steps'
import {
  workflowFailure as failure,
  failWith,
  outcomeFailure,
  requiredState,
  timeoutFailures,
} from './wizard-helpers'
import type { FulfillmentStep } from './wizard-options'

export function createDeliverySteps(step: FulfillmentStep, readiness: ReadinessSteps) {
  const requestPaymentCapture = step({
    description: 'Asks the payment partner to capture the authorized amount.',
    needs: { authorization: { optional: readiness.waitPaymentAuthorization } },
    run: async ({ context, deps, needs, idempotencyKey, update }) => {
      const authorizationId = requiredState(
        needs.authorization?.type === 'payment.authorization.succeeded'
          ? needs.authorization.data.authorizationId
          : undefined,
        'authorizationId',
      )
      const accepted = await deps.gateway.capturePayment({
        tenantId: context.tenantId,
        orderId: context.orderId,
        authorizationId,
        amountMinor: context.totalMinor,
        callbackUrl: context.callbackUrl,
        idempotencyKey,
      })
      update({ paymentCapture: { state: 'pending' }, updatedAt: deps.now() })
      return accepted
    },
    retry: { retries: 3, backoff: 'exponential' },
    idempotencyKey: ({ context }) => `order:${context.orderId}:capture-payment`,
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
    // The capture id arrives in a later callback, so the undo hook reads it from the context.
    compensate: async ({ context, deps }) => {
      const resourceId = context.paymentCapture.id
      if (resourceId === undefined) return
      await deps.gateway.refundPayment({
        tenantId: context.tenantId,
        orderId: context.orderId,
        resourceId,
        idempotencyKey: `order:${context.orderId}:refund-payment`,
      })
    },
    next: 'waitPaymentCapture',
  })
  const waitPaymentCapture = step({
    description: 'Waits up to two minutes for the payment partner to confirm the capture.',
    waitFor: {
      'payment.capture.succeeded': ({ payload, update }) =>
        update({
          paymentCapture: { state: 'captured', id: payload.data.captureId },
          updatedAt: payload.occurredAt,
        }),
      'payment.capture.failed': ({ payload, update }) =>
        update({
          paymentCapture: {
            state: 'failed',
            code: payload.data.code,
            reason: payload.data.reason,
          },
          lastFailure: failure(payload.data.code, payload.data.reason, 'payment.capture'),
          updatedAt: payload.occurredAt,
        }),
    },
    timeout: { after: '2m', next: 'markPaymentCaptureTimeout' },
    next: 'paymentCaptureGate',
  })
  const markPaymentCaptureTimeout = step({
    description: 'Records that the capture was never confirmed.',
    run: ({ deps, update }) => {
      update({
        paymentCapture: { state: 'timed_out' },
        lastFailure: timeoutFailures.paymentCapture,
        updatedAt: deps.now(),
      })
      return undefined
    },
    next: 'paymentCaptureGate',
  })
  const capture = { capture: { any: [waitPaymentCapture, markPaymentCaptureTimeout] } }
  const paymentCaptureGate = step({
    description: 'Continues to shipment only when the payment was captured.',
    needs: capture,
    targets: ['requestShipment', 'failPaymentCapture'],
    next: ({ needs }) =>
      needs.capture?.type === 'payment.capture.succeeded'
        ? 'requestShipment'
        : 'failPaymentCapture',
  })
  const failPaymentCapture = step({
    description: 'Fails the order with the reason the capture gave.',
    needs: capture,
    run: ({ needs }) =>
      failWith(outcomeFailure(needs.capture, timeoutFailures.paymentCapture)?.failure),
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
  })
  const requestShipment = step({
    description: 'Asks the carrier to ship the reserved inventory.',
    needs: { reservation: { optional: readiness.waitInventoryReservation } },
    run: async ({ context, deps, needs, idempotencyKey, update }) => {
      const reservationId = requiredState(
        needs.reservation?.type === 'inventory.reservation.succeeded'
          ? needs.reservation.data.reservationId
          : undefined,
        'reservationId',
      )
      const accepted = await deps.gateway.createShipment({
        tenantId: context.tenantId,
        orderId: context.orderId,
        reservationId,
        address: context.shippingAddress,
        callbackUrl: context.callbackUrl,
        idempotencyKey,
      })
      update({
        shipment: { state: 'pending', requestId: accepted.requestId },
        updatedAt: deps.now(),
      })
      return accepted
    },
    retry: { retries: 3, backoff: 'exponential' },
    idempotencyKey: ({ context }) => `order:${context.orderId}:create-shipment`,
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
    compensate: ({ context, deps, output }) =>
      deps.gateway.cancelShipment({
        tenantId: context.tenantId,
        orderId: context.orderId,
        resourceId: output.requestId,
        idempotencyKey: `order:${context.orderId}:cancel-shipment`,
      }),
    next: 'waitShipment',
  })
  const waitShipment = step({
    description: 'Waits up to five minutes for the carrier to confirm the shipment.',
    waitFor: {
      'shipping.shipment.succeeded': ({ payload, update }) =>
        update({
          shipment: {
            state: 'shipped',
            shipmentId: payload.data.shipmentId,
            carrier: payload.data.carrier,
            trackingNumber: payload.data.trackingNumber,
            trackingUrl: payload.data.trackingUrl,
          },
          updatedAt: payload.occurredAt,
        }),
      'shipping.shipment.failed': ({ payload, update }) =>
        update({
          shipment: {
            state: 'failed',
            code: payload.data.code,
            reason: payload.data.reason,
          },
          lastFailure: failure(payload.data.code, payload.data.reason, 'shipping.shipment'),
          updatedAt: payload.occurredAt,
        }),
    },
    timeout: { after: '5m', next: 'markShipmentTimeout' },
    next: 'shipmentGate',
  })
  const markShipmentTimeout = step({
    description: 'Records that the shipment was never confirmed.',
    run: ({ deps, update }) => {
      update({
        shipment: { state: 'timed_out' },
        lastFailure: timeoutFailures.shipment,
        updatedAt: deps.now(),
      })
      return undefined
    },
    next: 'shipmentGate',
  })
  const shipment = { shipment: { any: [waitShipment, markShipmentTimeout] } }
  const shipmentGate = step({
    description: 'Completes the order only when the carrier confirmed the shipment.',
    needs: shipment,
    targets: ['complete', 'failShipment'],
    next: ({ needs }) =>
      needs.shipment?.type === 'shipping.shipment.succeeded' ? 'complete' : 'failShipment',
  })
  const failShipment = step({
    description: 'Fails the order with the reason the carrier gave.',
    needs: shipment,
    run: ({ needs }) => failWith(outcomeFailure(needs.shipment, timeoutFailures.shipment)?.failure),
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
  })
  const complete = step({
    description: 'Returns the order id and the confirmed shipment id.',
    needs: shipment,
    run: ({ context, needs }) => ({
      orderId: context.orderId,
      shipmentId:
        needs.shipment?.type === 'shipping.shipment.succeeded'
          ? needs.shipment.data.shipmentId
          : undefined,
    }),
  })
  return {
    requestPaymentCapture,
    waitPaymentCapture,
    markPaymentCaptureTimeout,
    paymentCaptureGate,
    failPaymentCapture,
    requestShipment,
    waitShipment,
    markShipmentTimeout,
    shipmentGate,
    failShipment,
    complete,
  }
}
