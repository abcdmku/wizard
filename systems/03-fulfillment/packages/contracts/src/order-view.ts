import { z } from 'zod'
import {
  CurrencySchema,
  IsoDateTimeSchema,
  MoneyMinorSchema,
  OrderIdSchema,
  TenantIdSchema,
} from './common'
import { OrderLineSchema, ShippingAddressSchema } from './order-input'
import { PartnerIdentitySchema } from './partner'

export const CustomerOrderStatusSchema = z.enum([
  'processing',
  'fraud_review',
  'shipping',
  'shipped',
  'cancelling',
  'cancelled',
  'failed',
])

export const CustomerOrderSchema = z.object({
  id: OrderIdSchema,
  status: CustomerOrderStatusSchema,
  currency: CurrencySchema,
  totalMinor: MoneyMinorSchema,
  lines: z.array(OrderLineSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  shipment: z
    .object({
      carrier: z.string(),
      trackingNumber: z.string(),
      trackingUrl: z.url(),
    })
    .optional(),
  issue: z.object({ code: z.string(), message: z.string() }).optional(),
})

export const WorkflowStepSchema = z.object({
  id: z.string(),
  status: z.string(),
  phase: z.string().optional(),
  attempt: z.number().int().nonnegative(),
  error: z.object({ code: z.string().optional(), message: z.string() }).optional(),
})

export const OperatorOrderSchema = CustomerOrderSchema.extend({
  tenantId: TenantIdSchema,
  customerId: z.string(),
  shippingAddress: ShippingAddressSchema,
  partnerState: z.object({
    paymentAuthorization: z.object({ state: z.string(), id: z.string().optional() }),
    inventoryReservation: z.object({ state: z.string(), id: z.string().optional() }),
    paymentCapture: z.object({ state: z.string(), id: z.string().optional() }),
    shipment: z.object({ state: z.string(), requestId: z.string().optional() }),
  }),
  fraud: z.object({
    state: z.string(),
    reviewerId: z.string().optional(),
    note: z.string().optional(),
  }),
  workflow: z.object({
    status: z.string(),
    current: z.string().nullable(),
    seq: z.number().int().nonnegative(),
    bufferedCallbacks: z.number().int().nonnegative(),
    deadLetter: z.boolean(),
    steps: z.array(WorkflowStepSchema),
  }),
})

export const PartnerOrderSchema = z.object({
  id: OrderIdSchema,
  tenantId: TenantIdSchema,
  partner: PartnerIdentitySchema,
  status: z.string(),
  resource: z.object({ state: z.string(), id: z.string().optional() }),
})

export const CustomerOrderResponseSchema = z.object({ order: CustomerOrderSchema })
export const CustomerOrderListResponseSchema = z.object({ orders: z.array(CustomerOrderSchema) })
export const OperatorOrderResponseSchema = z.object({ order: OperatorOrderSchema })
export const OperatorOrderListResponseSchema = z.object({ orders: z.array(OperatorOrderSchema) })

export type CustomerOrderStatus = z.infer<typeof CustomerOrderStatusSchema>
export type CustomerOrder = z.infer<typeof CustomerOrderSchema>
export type OperatorOrder = z.infer<typeof OperatorOrderSchema>
export type PartnerOrder = z.infer<typeof PartnerOrderSchema>
export type CustomerOrderResponse = z.infer<typeof CustomerOrderResponseSchema>
export type CustomerOrderListResponse = z.infer<typeof CustomerOrderListResponseSchema>
export type OperatorOrderResponse = z.infer<typeof OperatorOrderResponseSchema>
export type OperatorOrderListResponse = z.infer<typeof OperatorOrderListResponseSchema>
