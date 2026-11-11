import {
  CurrencySchema,
  OrderIdSchema,
  OrderLineSchema,
  ShippingAddressSchema,
  TenantIdSchema,
} from '@fulfillment/contracts'
import { z } from 'zod'

const FailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  operation: z.string(),
})

const PaymentAuthorizationStateSchema = z.object({
  state: z.enum(['pending', 'authorized', 'failed', 'timed_out']),
  id: z.string().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
})

const InventoryReservationStateSchema = z.object({
  state: z.enum(['pending', 'reserved', 'failed', 'timed_out']),
  id: z.string().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
})

const PaymentCaptureStateSchema = z.object({
  state: z.enum(['idle', 'pending', 'captured', 'failed', 'timed_out']),
  id: z.string().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
})

const ShipmentStateSchema = z.object({
  state: z.enum(['idle', 'pending', 'shipped', 'failed', 'timed_out']),
  requestId: z.string().optional(),
  shipmentId: z.string().optional(),
  carrier: z.string().optional(),
  trackingNumber: z.string().optional(),
  trackingUrl: z.url().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
})

export const FulfillmentContextSchema = z.object({
  orderId: OrderIdSchema,
  tenantId: TenantIdSchema,
  customerId: z.string().min(1),
  currency: CurrencySchema,
  totalMinor: z.number().int().positive(),
  lines: z.array(OrderLineSchema).min(1),
  shippingAddress: ShippingAddressSchema,
  callbackUrl: z.url(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  paymentAuthorization: PaymentAuthorizationStateSchema,
  inventoryReservation: InventoryReservationStateSchema,
  paymentCapture: PaymentCaptureStateSchema,
  fraud: z.object({
    state: z.enum(['pending', 'approved', 'rejected', 'timed_out']),
    reviewerId: z.string().optional(),
    note: z.string().optional(),
  }),
  shipment: ShipmentStateSchema,
  lastFailure: FailureSchema.optional(),
})

export type FulfillmentContext = z.infer<typeof FulfillmentContextSchema>
export type FulfillmentFailure = z.infer<typeof FailureSchema>
