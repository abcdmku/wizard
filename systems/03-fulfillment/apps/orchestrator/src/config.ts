import { randomUUID } from 'node:crypto'
import { type AuthPrincipal, AuthPrincipalSchema } from '@fulfillment/contracts'
import { z } from 'zod'

const BooleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  AWS_ENDPOINT_URL: z.url().default('http://localhost:4566'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).default('test'),
  ORDER_TOPIC_ARN: z
    .string()
    .min(1)
    .default('arn:aws:sns:us-east-1:000000000000:fulfillment-order'),
  PAYMENT_TOPIC_ARN: z
    .string()
    .min(1)
    .default('arn:aws:sns:us-east-1:000000000000:fulfillment-payment'),
  INVENTORY_TOPIC_ARN: z
    .string()
    .min(1)
    .default('arn:aws:sns:us-east-1:000000000000:fulfillment-inventory'),
  SHIPPING_TOPIC_ARN: z
    .string()
    .min(1)
    .default('arn:aws:sns:us-east-1:000000000000:fulfillment-shipping'),
  PUBLIC_ORCHESTRATOR_URL: z.url().default('http://localhost:3001'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-payment-secret-change-me'),
  INVENTORY_WEBHOOK_SECRET: z.string().min(16).default('dev-inventory-secret-change-me'),
  SHIPPING_WEBHOOK_SECRET: z.string().min(16).default('dev-shipping-secret-change-me'),
  AUTH_TOKENS_JSON: z.string().optional(),
  SEED_ON_START: BooleanStringSchema,
  SEED_KEY: z.string().min(8).default('dev-seed-key'),
  OWNER_ID: z.string().min(1).optional(),
  LEASE_TTL_MS: z.coerce.number().int().positive().default(5_000),
  LEASE_RENEW_MS: z.coerce.number().int().positive().default(1_500),
})

const TokenMapSchema = z.record(z.string().min(1), AuthPrincipalSchema)

const demoTokens: Readonly<Record<string, AuthPrincipal>> = {
  'customer-acme': { role: 'customer', tenantId: 'tenant-acme', subjectId: 'customer-alice' },
  'operator-acme': { role: 'operator', tenantId: 'tenant-acme', subjectId: 'operator-olivia' },
  'operator-globex': {
    role: 'operator',
    tenantId: 'tenant-globex',
    subjectId: 'operator-gabriel',
  },
  'customer-globex': {
    role: 'customer',
    tenantId: 'tenant-globex',
    subjectId: 'customer-gary',
  },
}

export type OrchestratorConfig = ReturnType<typeof loadConfig>

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = EnvironmentSchema.parse(source)
  const authTokens = parseTokens(env.AUTH_TOKENS_JSON, env.NODE_ENV)
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    aws: {
      endpoint: env.AWS_ENDPOINT_URL,
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
      topics: {
        order: env.ORDER_TOPIC_ARN,
        payment: env.PAYMENT_TOPIC_ARN,
        inventory: env.INVENTORY_TOPIC_ARN,
        shipping: env.SHIPPING_TOPIC_ARN,
      },
    },
    callbackUrl: `${env.PUBLIC_ORCHESTRATOR_URL}/api/webhooks/partner`,
    webhookSecrets: {
      payment: env.PAYMENT_WEBHOOK_SECRET,
      inventory: env.INVENTORY_WEBHOOK_SECRET,
      shipping: env.SHIPPING_WEBHOOK_SECRET,
    },
    authTokens,
    seedOnStart: env.SEED_ON_START,
    seedKey: env.SEED_KEY,
    ownerId: env.OWNER_ID ?? `orchestrator-${randomUUID()}`,
    leaseTtlMs: env.LEASE_TTL_MS,
    leaseRenewMs: env.LEASE_RENEW_MS,
  } as const
}

function parseTokens(value: string | undefined, environment: string) {
  if (value === undefined) {
    if (environment === 'production') throw new Error('AUTH_TOKENS_JSON is required in production')
    return demoTokens
  }
  const decoded: unknown = JSON.parse(value)
  return TokenMapSchema.parse(decoded)
}
