import { mappedFailure } from './failures'
import { failFromContext, workflowFailure as failure, requiredState } from './workflow-helpers'
import type { FulfillmentStep } from './workflow-options'

export function createDeliverySteps(step: FulfillmentStep) {
  return {
    requestPaymentCapture: step({
      run: async ({ context, deps, idempotencyKey, update }) => {
        const authorizationId = requiredState(context.paymentAuthorization.id, 'authorizationId')
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
    }),
    waitPaymentCapture: step({
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
    }),
    markPaymentCaptureTimeout: step({
      run: ({ deps, update }) =>
        update({
          paymentCapture: { state: 'timed_out' },
          lastFailure: failure(
            'PAYMENT_CAPTURE_TIMEOUT',
            'Payment capture timed out',
            'payment.capture',
            true,
          ),
          updatedAt: deps.now(),
        }),
      next: 'paymentCaptureGate',
    }),
    paymentCaptureGate: step({
      targets: ['requestShipment', 'failPaymentCapture'],
      next: ({ context }) =>
        context.paymentCapture.state === 'captured' ? 'requestShipment' : 'failPaymentCapture',
    }),
    failPaymentCapture: step({
      run: ({ context }) => failFromContext(context.lastFailure),
      mapError: (error, { attempt }) => mappedFailure(error, attempt),
    }),
    requestShipment: step({
      run: async ({ context, deps, idempotencyKey, update }) => {
        const reservationId = requiredState(context.inventoryReservation.id, 'reservationId')
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
    }),
    waitShipment: step({
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
    }),
    markShipmentTimeout: step({
      run: ({ deps, update }) =>
        update({
          shipment: { state: 'timed_out' },
          lastFailure: failure(
            'SHIPMENT_TIMEOUT',
            'Shipment confirmation timed out',
            'shipping.shipment',
            true,
          ),
          updatedAt: deps.now(),
        }),
      next: 'shipmentGate',
    }),
    shipmentGate: step({
      targets: ['complete', 'failShipment'],
      next: ({ context }) => (context.shipment.state === 'shipped' ? 'complete' : 'failShipment'),
    }),
    failShipment: step({
      run: ({ context }) => failFromContext(context.lastFailure),
      mapError: (error, { attempt }) => mappedFailure(error, attempt),
    }),
    complete: step({
      run: ({ context }) => ({
        orderId: context.orderId,
        shipmentId: context.shipment.shipmentId,
      }),
    }),
  }
}
