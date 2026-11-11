import { IdSchema, OrderIdSchema } from '@fulfillment/contracts'
import { z } from 'zod'
import { FulfillmentServiceError } from './errors'

export const OrderParamsSchema = z.object({ id: OrderIdSchema })
export const FraudParamsSchema = z.object({
  id: OrderIdSchema,
  action: z.enum(['approve', 'reject']),
})
export const FraudBodySchema = z.object({ note: z.string().trim().max(1_000).optional() })

export function parseJsonBody(value: unknown): unknown {
  if (typeof value !== 'string') {
    throw new FulfillmentServiceError('INVALID_OPERATION', 'JSON request body is required', 400)
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    throw new FulfillmentServiceError('INVALID_OPERATION', 'Request body is not valid JSON', 400)
  }
}

export function idempotencyKey(value: string | string[] | undefined): string {
  const parsed = IdSchema.max(128).safeParse(value)
  if (!parsed.success) {
    throw new FulfillmentServiceError('INVALID_OPERATION', 'Idempotency-Key is required', 400)
  }
  return parsed.data
}
