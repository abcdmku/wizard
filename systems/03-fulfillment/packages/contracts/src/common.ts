import { z } from 'zod'

export const IdSchema = z.string().trim().min(1).max(128)
export const TenantIdSchema = IdSchema
export const OrderIdSchema = z.string().uuid()
export const IsoDateTimeSchema = z.iso.datetime({ offset: true })
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/)
export const MoneyMinorSchema = z.number().int().nonnegative().max(100_000_000)

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
})

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  database: z.enum(['up', 'not_configured']),
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
