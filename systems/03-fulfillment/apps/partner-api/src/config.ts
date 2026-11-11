import { z } from 'zod'

const EnvironmentSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3002),
  CALLBACK_DELAY_MS: z.coerce.number().int().nonnegative().default(100),
  PARTNER_WEBHOOK_SECRET: z.string().min(16).default('local-partner-webhook-secret'),
})

export type PartnerApiConfig = ReturnType<typeof loadConfig>

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = EnvironmentSchema.parse(source)
  return {
    host: env.HOST,
    port: env.PORT,
    callbackDelayMs: env.CALLBACK_DELAY_MS,
    webhookSecret: env.PARTNER_WEBHOOK_SECRET,
  } as const
}
