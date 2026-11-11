import { z } from 'zod'
import { ApplicationViewSchema } from './api-contract.js'

export const ApplicationStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), data: ApplicationViewSchema }).strict(),
  z.object({ type: z.literal('state'), data: ApplicationViewSchema }).strict(),
  z.object({ type: z.literal('heartbeat'), at: z.number().int().nonnegative() }).strict(),
])
export type ApplicationStreamEvent = z.infer<typeof ApplicationStreamEventSchema>
