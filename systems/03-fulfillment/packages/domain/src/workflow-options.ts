import {
  InventoryReservationFailedCallbackSchema,
  InventoryReservedCallbackSchema,
  PaymentAuthorizationFailedCallbackSchema,
  PaymentAuthorizedCallbackSchema,
  PaymentCapturedCallbackSchema,
  PaymentCaptureFailedCallbackSchema,
  ShipmentFailedCallbackSchema,
  ShipmentSucceededCallbackSchema,
} from '@fulfillment/contracts'
import { boundary, type StepApi, type WizardHeader } from '@openwizard/core'
import type { z } from 'zod'
import { FraudReviewedEventSchema, OrderCancelledEventSchema } from './events'
import type { FulfillmentDependencies } from './gateway'
import { type FulfillmentContext, FulfillmentContextSchema } from './model'

const events = {
  'payment.authorization.succeeded': PaymentAuthorizedCallbackSchema,
  'payment.authorization.failed': PaymentAuthorizationFailedCallbackSchema,
  'inventory.reservation.succeeded': InventoryReservedCallbackSchema,
  'inventory.reservation.failed': InventoryReservationFailedCallbackSchema,
  'payment.capture.succeeded': PaymentCapturedCallbackSchema,
  'payment.capture.failed': PaymentCaptureFailedCallbackSchema,
  'shipping.shipment.succeeded': ShipmentSucceededCallbackSchema,
  'shipping.shipment.failed': ShipmentFailedCallbackSchema,
  'fraud.reviewed': FraudReviewedEventSchema,
  'order.cancelled': OrderCancelledEventSchema,
}

type FulfillmentEvents = { [E in keyof typeof events]: z.infer<(typeof events)[E]> }
export type FulfillmentStep = StepApi<
  FulfillmentContext,
  FulfillmentEvents,
  FulfillmentDependencies
>['step']

export const fulfillmentOptions = {
  name: 'durable-order-fulfillment',
  version: 1,
  context: FulfillmentContextSchema,
  deps: boundary.trusted<FulfillmentDependencies>(),
  concurrency: 2,
  events,
  correlate: {
    'payment.authorization.succeeded': (payload) => payload.orderId,
    'payment.authorization.failed': (payload) => payload.orderId,
    'inventory.reservation.succeeded': (payload) => payload.orderId,
    'inventory.reservation.failed': (payload) => payload.orderId,
    'payment.capture.succeeded': (payload) => payload.orderId,
    'payment.capture.failed': (payload) => payload.orderId,
    'shipping.shipment.succeeded': (payload) => payload.orderId,
    'shipping.shipment.failed': (payload) => payload.orderId,
    'fraud.reviewed': (payload) => payload.orderId,
    'order.cancelled': (payload) => payload.orderId,
  },
  on: {
    'order.cancelled': ({ payload }) => ({ cancel: payload.reason }),
  },
  unmatchedEvents: { buffer: true, ttl: '30m' },
  onFailure: 'compensate',
} satisfies WizardHeader<
  FulfillmentContext,
  z.input<typeof FulfillmentContextSchema>,
  FulfillmentEvents,
  FulfillmentDependencies,
  never
>
