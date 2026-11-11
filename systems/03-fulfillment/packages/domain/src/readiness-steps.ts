import { mappedFailure } from './failures'
import {
  workflowFailure as failure,
  failWith,
  fraudRejected,
  outcomeFailure,
  timeoutFailures,
} from './wizard-helpers'
import type { FulfillmentStep } from './wizard-options'

// A partner wait keeps the callback that completed it as its output. Later steps read it with
// `needs`, joined with the timeout step so they also run when the partner never answers. The
// context holds the same facts for the projections and for compensation.

export function createReadinessSteps(step: FulfillmentStep) {
  const begin = step({
    description: 'Starts the payment and inventory branches together.',
    next: ['requestPaymentAuthorization', 'requestInventoryReservation'],
  })
  const requestPaymentAuthorization = step({
    description: 'Asks the payment partner to authorize the order total.',
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
    idempotencyKey: ({ context }) => `order:${context.orderId}:authorize-payment`,
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
    // The ids arrive in callbacks after this step, so the undo hook reads them from the context.
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
  })
  const waitPaymentAuthorization = step({
    description: 'Waits up to two minutes for the payment partner to confirm the authorization.',
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
  })
  const markPaymentAuthorizationTimeout = step({
    description: 'Records that the payment authorization was never confirmed.',
    run: ({ deps, update }) => {
      update({
        paymentAuthorization: { state: 'timed_out' },
        lastFailure: timeoutFailures.paymentAuthorization,
        updatedAt: deps.now(),
      })
      return undefined
    },
    next: 'paymentBranchComplete',
  })
  const paymentBranchComplete = step({
    description: 'Ends the payment branch, confirmed or not.',
    next: 'readinessJoin',
  })
  const requestInventoryReservation = step({
    description: 'Asks the inventory partner to reserve every order line.',
    run: ({ context, deps, idempotencyKey }) =>
      deps.gateway.reserveInventory({
        tenantId: context.tenantId,
        orderId: context.orderId,
        lines: context.lines,
        callbackUrl: context.callbackUrl,
        idempotencyKey,
      }),
    retry: { retries: 3, backoff: 'exponential' },
    idempotencyKey: ({ context }) => `order:${context.orderId}:reserve-inventory`,
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
    // The reservation id arrives in a later callback, so the undo hook reads it from the context.
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
  })
  const waitInventoryReservation = step({
    description: 'Waits up to two minutes for the inventory partner to confirm the reservation.',
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
  })
  const markInventoryReservationTimeout = step({
    description: 'Records that the inventory reservation was never confirmed.',
    run: ({ deps, update }) => {
      update({
        inventoryReservation: { state: 'timed_out' },
        lastFailure: timeoutFailures.inventoryReservation,
        updatedAt: deps.now(),
      })
      return undefined
    },
    next: 'inventoryBranchComplete',
  })
  const inventoryBranchComplete = step({
    description: 'Ends the inventory branch, confirmed or not.',
    next: 'readinessJoin',
  })
  const readinessJoin = step({
    description: 'Waits for both branches to end.',
    needs: { paymentBranchComplete, inventoryBranchComplete },
    next: 'readinessGate',
  })
  const readiness = {
    payment: { any: [waitPaymentAuthorization, markPaymentAuthorizationTimeout] },
    inventory: { any: [waitInventoryReservation, markInventoryReservationTimeout] },
  }
  const readinessGate = step({
    description: 'Continues to fraud review only when payment and inventory both succeeded.',
    needs: { ...readiness, readinessJoin },
    targets: ['waitFraudReview', 'failReadiness'],
    next: ({ needs }) =>
      needs.payment?.type === 'payment.authorization.succeeded' &&
      needs.inventory?.type === 'inventory.reservation.succeeded'
        ? 'waitFraudReview'
        : 'failReadiness',
  })
  const failReadiness = step({
    description: 'Fails the order with the reason payment or inventory gave.',
    needs: readiness,
    run: ({ needs }) => {
      const payment = outcomeFailure(needs.payment, timeoutFailures.paymentAuthorization)
      const inventory = outcomeFailure(needs.inventory, timeoutFailures.inventoryReservation)
      // When both branches failed, report the later failure. A timeout counts as the latest.
      const last =
        payment !== undefined && (inventory === undefined || payment.at > inventory.at)
          ? payment
          : inventory
      return failWith(last?.failure)
    },
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
  })
  const waitFraudReview = step({
    description: 'Waits up to fifteen minutes for an operator to approve or reject the order.',
    waitFor: {
      'fraud.reviewed': ({ payload, update }) => {
        update({
          fraud: {
            state: payload.decision === 'approve' ? 'approved' : 'rejected',
            reviewerId: payload.reviewerId,
            ...(payload.note === undefined ? {} : { note: payload.note }),
          },
          ...(payload.decision === 'reject' ? { lastFailure: fraudRejected } : {}),
          updatedAt: payload.decidedAt,
        })
        return { done: payload.decision }
      },
    },
    timeout: { after: '15m', next: 'markFraudReviewTimeout' },
    targets: ['requestPaymentCapture', 'failFraudReview'],
    next: ({ output }) => (output === 'approve' ? 'requestPaymentCapture' : 'failFraudReview'),
  })
  const markFraudReviewTimeout = step({
    description: 'Records that nobody reviewed the order in time.',
    run: ({ deps, update }) => {
      update({
        fraud: { state: 'timed_out' },
        lastFailure: timeoutFailures.fraudReview,
        updatedAt: deps.now(),
      })
      return undefined
    },
    next: 'failFraudReview',
  })
  const failFraudReview = step({
    description: 'Fails the order after a rejected or missing fraud review.',
    needs: { decision: { any: [waitFraudReview, markFraudReviewTimeout] } },
    run: ({ needs }) =>
      failWith(needs.decision === 'reject' ? fraudRejected : timeoutFailures.fraudReview),
    mapError: (error, { attempt }) => mappedFailure(error, attempt),
  })
  return {
    begin,
    requestPaymentAuthorization,
    waitPaymentAuthorization,
    markPaymentAuthorizationTimeout,
    paymentBranchComplete,
    requestInventoryReservation,
    waitInventoryReservation,
    markInventoryReservationTimeout,
    inventoryBranchComplete,
    readinessJoin,
    readinessGate,
    failReadiness,
    waitFraudReview,
    markFraudReviewTimeout,
    failFraudReview,
  }
}

export type ReadinessSteps = ReturnType<typeof createReadinessSteps>
