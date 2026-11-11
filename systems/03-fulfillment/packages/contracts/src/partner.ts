import { z } from 'zod'
import {
  CurrencySchema,
  IdSchema,
  IsoDateTimeSchema,
  MoneyMinorSchema,
  OrderIdSchema,
  TenantIdSchema,
} from './common'
import { OrderLineSchema, ShippingAddressSchema } from './order-input'

export const PartnerIdentitySchema = z.enum(['payment', 'inventory', 'shipping'])
export const WorkTypeSchema = z.enum([
  'payment.authorization.requested',
  'payment.capture.requested',
  'payment.authorization.void.requested',
  'payment.refund.requested',
  'inventory.reservation.requested',
  'inventory.release.requested',
  'shipping.requested',
  'shipping.cancel.requested',
])

export const workTypesByService: Readonly<
  Record<z.infer<typeof PartnerIdentitySchema>, readonly z.infer<typeof WorkTypeSchema>[]>
> = {
  payment: [
    'payment.authorization.requested',
    'payment.capture.requested',
    'payment.authorization.void.requested',
    'payment.refund.requested',
  ],
  inventory: ['inventory.reservation.requested', 'inventory.release.requested'],
  shipping: ['shipping.requested', 'shipping.cancel.requested'],
}

export const WorkEnvelopeSchema = z
  .object({
    eventId: IdSchema.max(200),
    orderId: OrderIdSchema,
    tenantId: TenantIdSchema,
    type: WorkTypeSchema,
    attempt: z.number().int().nonnegative(),
    occurredAt: IsoDateTimeSchema,
    data: z.record(z.string(), z.unknown()),
  })
  .strict()

const CallbackBaseSchema = z.object({
  eventId: IdSchema,
  occurredAt: IsoDateTimeSchema,
  tenantId: TenantIdSchema,
  orderId: OrderIdSchema,
})

export const PaymentAuthorizedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('payment.authorization.succeeded'),
  data: z.object({ authorizationId: IdSchema }),
})
export const PaymentAuthorizationFailedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('payment.authorization.failed'),
  data: z.object({ code: IdSchema, reason: z.string().min(1) }),
})
export const InventoryReservedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('inventory.reservation.succeeded'),
  data: z.object({ reservationId: IdSchema }),
})
export const InventoryReservationFailedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('inventory.reservation.failed'),
  data: z.object({ code: IdSchema, reason: z.string().min(1) }),
})
export const PaymentCapturedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('payment.capture.succeeded'),
  data: z.object({ captureId: IdSchema }),
})
export const PaymentCaptureFailedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('payment.capture.failed'),
  data: z.object({ code: IdSchema, reason: z.string().min(1) }),
})
export const ShipmentSucceededCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('shipping.shipment.succeeded'),
  data: z.object({
    shipmentId: IdSchema,
    carrier: z.string().min(1),
    trackingNumber: IdSchema,
    trackingUrl: z.url(),
  }),
})
export const ShipmentFailedCallbackSchema = CallbackBaseSchema.extend({
  type: z.literal('shipping.shipment.failed'),
  data: z.object({ code: IdSchema, reason: z.string().min(1) }),
})

export const PartnerCallbackSchema = z.discriminatedUnion('type', [
  PaymentAuthorizedCallbackSchema,
  PaymentAuthorizationFailedCallbackSchema,
  InventoryReservedCallbackSchema,
  InventoryReservationFailedCallbackSchema,
  PaymentCapturedCallbackSchema,
  PaymentCaptureFailedCallbackSchema,
  ShipmentSucceededCallbackSchema,
  ShipmentFailedCallbackSchema,
])

const PartnerRequestBaseSchema = z.object({
  tenantId: TenantIdSchema,
  orderId: OrderIdSchema,
  callbackUrl: z.url(),
  idempotencyKey: IdSchema,
})

export const AuthorizePaymentRequestSchema = PartnerRequestBaseSchema.extend({
  amountMinor: MoneyMinorSchema,
  currency: CurrencySchema,
})
export const ReserveInventoryRequestSchema = PartnerRequestBaseSchema.extend({
  lines: z.array(OrderLineSchema).min(1),
})
export const CapturePaymentRequestSchema = PartnerRequestBaseSchema.extend({
  authorizationId: IdSchema,
  amountMinor: MoneyMinorSchema,
})
export const CreateShipmentRequestSchema = PartnerRequestBaseSchema.extend({
  reservationId: IdSchema,
  address: ShippingAddressSchema,
})
export const ReversalRequestSchema = z.object({
  tenantId: TenantIdSchema,
  orderId: OrderIdSchema,
  resourceId: IdSchema,
  idempotencyKey: IdSchema,
})
export const PartnerAcceptedSchema = z.object({
  accepted: z.literal(true),
  requestId: IdSchema,
  duplicate: z.boolean(),
})

export type PartnerCallback = z.infer<typeof PartnerCallbackSchema>
export type PartnerIdentity = z.infer<typeof PartnerIdentitySchema>
export type WorkType = z.infer<typeof WorkTypeSchema>
export type WorkEnvelope = z.infer<typeof WorkEnvelopeSchema>
export type AuthorizePaymentRequest = z.infer<typeof AuthorizePaymentRequestSchema>
export type ReserveInventoryRequest = z.infer<typeof ReserveInventoryRequestSchema>
export type CapturePaymentRequest = z.infer<typeof CapturePaymentRequestSchema>
export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequestSchema>
export type ReversalRequest = z.infer<typeof ReversalRequestSchema>
export type PartnerAccepted = z.infer<typeof PartnerAcceptedSchema>
