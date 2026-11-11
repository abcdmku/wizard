import { z } from 'zod'
import { CurrencySchema, IdSchema } from './common'

export const OrderLineSchema = z.object({
  sku: IdSchema,
  name: z.string().trim().min(1).max(160),
  quantity: z.number().int().positive().max(100),
  unitPriceMinor: z.number().int().positive().max(10_000_000),
})

export const ShippingAddressSchema = z.object({
  recipient: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(2).max(24),
  country: z.string().regex(/^[A-Z]{2}$/),
})

export const CreateOrderSchema = z.object({
  currency: CurrencySchema,
  lines: z.array(OrderLineSchema).min(1).max(100),
  shippingAddress: ShippingAddressSchema,
})

export const CancelOrderSchema = z.object({
  reason: z.string().trim().min(1).max(240),
})

export const FraudDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1_000).optional(),
})

export type OrderLine = z.infer<typeof OrderLineSchema>
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>
export type CreateOrder = z.infer<typeof CreateOrderSchema>
export type CancelOrder = z.infer<typeof CancelOrderSchema>
export type FraudDecision = z.infer<typeof FraudDecisionSchema>
