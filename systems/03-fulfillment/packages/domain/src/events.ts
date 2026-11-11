import { OrderIdSchema } from '@fulfillment/contracts'
import { z } from 'zod'

export const FraudReviewedEventSchema = z.object({
  orderId: OrderIdSchema,
  decision: z.enum(['approve', 'reject']),
  reviewerId: z.string().min(1),
  note: z.string().max(1_000).optional(),
  decidedAt: z.iso.datetime({ offset: true }),
})

export const OrderCancelledEventSchema = z.object({
  orderId: OrderIdSchema,
  reason: z.string().min(1).max(240),
  cancelledBy: z.string().min(1),
  cancelledAt: z.iso.datetime({ offset: true }),
})
