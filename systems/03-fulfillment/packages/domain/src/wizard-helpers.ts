import type { PartnerCallback } from '@fulfillment/contracts'
import { FulfillmentWorkflowError } from './failures'
import type { FulfillmentFailure } from './model'

export const workflowFailure = (
  code: string,
  message: string,
  operation: string,
  retryable = false,
): FulfillmentFailure => ({ code, message, operation, retryable })

/** The failure each timeout step records when a partner or a reviewer does not answer. */
export const timeoutFailures = {
  paymentAuthorization: workflowFailure(
    'PAYMENT_AUTHORIZATION_TIMEOUT',
    'Payment authorization timed out',
    'payment.authorization',
    true,
  ),
  inventoryReservation: workflowFailure(
    'INVENTORY_RESERVATION_TIMEOUT',
    'Inventory reservation timed out',
    'inventory.reservation',
    true,
  ),
  fraudReview: workflowFailure(
    'FRAUD_REVIEW_TIMEOUT',
    'Fraud review timed out',
    'fraud.review',
    true,
  ),
  paymentCapture: workflowFailure(
    'PAYMENT_CAPTURE_TIMEOUT',
    'Payment capture timed out',
    'payment.capture',
    true,
  ),
  shipment: workflowFailure(
    'SHIPMENT_TIMEOUT',
    'Shipment confirmation timed out',
    'shipping.shipment',
    true,
  ),
} as const

export const fraudRejected = workflowFailure(
  'FRAUD_REJECTED',
  'An operator rejected the fraud review',
  'fraud.review',
)

/** The failure a partner outcome stands for, or `undefined` when the partner succeeded. */
export function outcomeFailure(
  outcome: PartnerCallback | undefined,
  timeout: FulfillmentFailure,
): { readonly failure: FulfillmentFailure; readonly at: number } | undefined {
  if (outcome === undefined) return { failure: timeout, at: Number.POSITIVE_INFINITY }
  if (!('code' in outcome.data)) return undefined
  return {
    failure: workflowFailure(outcome.data.code, outcome.data.reason, timeout.operation),
    at: Date.parse(outcome.occurredAt),
  }
}

/** Fails the step with the given failure, so the run compensates and reports it. */
export const failWith = (failure: FulfillmentFailure | undefined): never => {
  throw new FulfillmentWorkflowError(
    failure ?? workflowFailure('FULFILLMENT_FAILED', 'The order could not continue', 'workflow'),
  )
}

/** The id a successful partner callback carries, or a `STATE_INCOMPLETE` failure. */
export const requiredState = (value: string | undefined, name: string): string =>
  value ?? failWith(workflowFailure('STATE_INCOMPLETE', `${name} is missing`, name))
