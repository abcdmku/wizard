import { z } from 'zod'
import { IdSchema, TenantIdSchema } from './common'

export const CustomerPrincipalSchema = z.object({
  role: z.literal('customer'),
  tenantId: TenantIdSchema,
  subjectId: IdSchema,
})

export const OperatorPrincipalSchema = z.object({
  role: z.literal('operator'),
  tenantId: TenantIdSchema,
  subjectId: IdSchema,
})

export const AuthPrincipalSchema = z.discriminatedUnion('role', [
  CustomerPrincipalSchema,
  OperatorPrincipalSchema,
])

export type CustomerPrincipal = z.infer<typeof CustomerPrincipalSchema>
export type OperatorPrincipal = z.infer<typeof OperatorPrincipalSchema>
export type AuthPrincipal = z.infer<typeof AuthPrincipalSchema>
