import { mappedFailure } from './failures'
import { failFromContext, workflowFailure as failure } from './workflow-helpers'
import type { FulfillmentStep } from './workflow-options'

export function createReadinessSteps(step: FulfillmentStep) {
  return {
    begin: step({
      next: ['requestPaymentAuthorization', 'requestInventoryReservation'],
    }),
    requestPaymentAuthorization: step({
      run: ({ context, deps, idempotencyKey }) =>
        deps.gateway.authorizePayment({
          tenantId: context.tenantId,
          orderId: context.orderId,
          amountMinor: context.totalMinor,
          currency: context.currency,
          callbackUrl: context.callbackUrl,
          idempotencyKey,
        }),
      retry: { retries: 3, backoff: 'exponential' },
      idempotent: ({ context }) => `order:${context.orderId}:authorize-payment`,
      mapError: (error, { attempt }) => mappedFailure(error, attempt),
      compensate: async ({ context, deps }) => {
        if (context.paymentCapture.id !== undefined) return
        const resourceId = context.paymentAuthorization.id
        if (resourceId === undefined) return
        await deps.gateway.voidAuthorization({
          tenantId: context.tenantId,
          orderId: context.orderId,
          resourceId,
          idempotencyKey: `order:${context.orderId}:void-authorization`,
        })
      },
      next: 'waitPaymentAuthorization',
    }),
    waitPaymentAuthorization: step({
      waitFor: {
        'payment.authorization.succeeded': ({ payload, update }) =>
          update({
            paymentAuthorization: { state: 'authorized', id: payload.data.authorizationId },
            updatedAt: payload.occurredAt,
          }),
        'payment.authorization.failed': ({ payload, update }) =>
          update({
            paymentAuthorization: {
              state: 'failed',
              code: payload.data.code,
              reason: payload.data.reason,
            },
            lastFailure: failure(payload.data.code, payload.data.reason, 'payment.authorization'),
            updatedAt: payload.occurredAt,
          }),
      },
      timeout: { after: '2m', next: 'markPaymentAuthorizationTimeout' },
      next: 'paymentBranchComplete',
    }),
    markPaymentAuthorizationTimeout: step({
      run: ({ deps, update }) =>
        update({
          paymentAuthorization: { state: 'timed_out' },
          lastFailure: failure(
            'PAYMENT_AUTHORIZATION_TIMEOUT',
            'Payment authorization timed out',
            'payment.authorization',
            true,
          ),
          updatedAt: deps.now(),
        }),
      next: 'paymentBranchComplete',
    }),
    paymentBranchComplete: step({ next: 'readinessJoin' }),
    requestInventoryReservation: step({
      run: ({ context, deps, idempotencyKey }) =>
        deps.gateway.reserveInventory({
          tenantId: context.tenantId,
          orderId: context.orderId,
          lines: context.lines,
          callbackUrl: context.callbackUrl,
          idempotencyKey,
        }),
      retry: { retries: 3, backoff: 'exponential' },
      idempotent: ({ context }) => `order:${context.orderId}:reserve-inventory`,
      mapError: (error, { attempt }) => mappedFailure(error, attempt),
      compensate: async ({ context, deps }) => {
        const resourceId = context.inventoryReservation.id
        if (resourceId === undefined) return
        await deps.gateway.releaseInventory({
          tenantId: context.tenantId,
          orderId: context.orderId,
          resourceId,
          idempotencyKey: `order:${context.orderId}:release-inventory`,
        })
      },
      next: 'waitInventoryReservation',
    }),
    waitInventoryReservation: step({
      waitFor: {
        'inventory.reservation.succeeded': ({ payload, update }) =>
          update({
            inventoryReservation: { state: 'reserved', id: payload.data.reservationId },
            updatedAt: payload.occurredAt,
          }),
        'inventory.reservation.failed': ({ payload, update }) =>
          update({
            inventoryReservation: {
              state: 'failed',
              code: payload.data.code,
              reason: payload.data.reason,
            },
            lastFailure: failure(payload.data.code, payload.data.reason, 'inventory.reservation'),
            updatedAt: payload.occurredAt,
          }),
      },
      timeout: { after: '2m', next: 'markInventoryReservationTimeout' },
      next: 'inventoryBranchComplete',
    }),
    markInventoryReservationTimeout: step({
      run: ({ deps, update }) =>
        update({
          inventoryReservation: { state: 'timed_out' },
          lastFailure: failure(
            'INVENTORY_RESERVATION_TIMEOUT',
            'Inventory reservation timed out',
            'inventory.reservation',
            true,
          ),
          updatedAt: deps.now(),
        }),
      next: 'inventoryBranchComplete',
    }),
    inventoryBranchComplete: step({ next: 'readinessJoin' }),
    readinessJoin: step({
      dependsOn: ['paymentBranchComplete', 'inventoryBranchComplete'],
      next: 'readinessGate',
    }),
    readinessGate: step({
      targets: ['waitFraudReview', 'failReadiness'],
      next: ({ context }) =>
        context.paymentAuthorization.state === 'authorized' &&
        context.inventoryReservation.state === 'reserved'
          ? 'waitFraudReview'
          : 'failReadiness',
    }),
    failReadiness: step({
      run: ({ context }) => failFromContext(context.lastFailure),
      mapError: (error, { attempt }) => mappedFailure(error, attempt),
    }),
    waitFraudReview: step({
      waitFor: {
        'fraud.reviewed': ({ payload, update }) => {
          update({
            fraud: {
              state: payload.decision === 'approve' ? 'approved' : 'rejected',
              reviewerId: payload.reviewerId,
              ...(payload.note === undefined ? {} : { note: payload.note }),
            },
            ...(payload.decision === 'reject'
              ? {
                  lastFailure: failure(
                    'FRAUD_REJECTED',
                    'An operator rejected the fraud review',
                    'fraud.review',
                  ),
                }
              : {}),
            updatedAt: payload.decidedAt,
          })
          return { done: payload.decision }
        },
      },
      timeout: { after: '15m', next: 'markFraudReviewTimeout' },
      targets: ['requestPaymentCapture', 'failFraudReview'],
      next: ({ context }) =>
        context.fraud.state === 'approved' ? 'requestPaymentCapture' : 'failFraudReview',
    }),
    markFraudReviewTimeout: step({
      run: ({ deps, update }) =>
        update({
          fraud: { state: 'timed_out' },
          lastFailure: failure(
            'FRAUD_REVIEW_TIMEOUT',
            'Fraud review timed out',
            'fraud.review',
            true,
          ),
          updatedAt: deps.now(),
        }),
      next: 'failFraudReview',
    }),
    failFraudReview: step({
      run: ({ context }) => failFromContext(context.lastFailure),
      mapError: (error, { attempt }) => mappedFailure(error, attempt),
    }),
  }
}
