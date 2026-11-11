import { ErrorResponseSchema, fulfillmentRoutes } from '@fulfillment/contracts'
import type { ZodType } from 'zod'

export const orchestratorUrl = process.env.FULFILLMENT_ORCHESTRATOR_URL ?? 'http://localhost:4510'
export const partnerUrl = process.env.FULFILLMENT_PARTNER_URL ?? 'http://localhost:4520'
export const integrationEnabled = process.env.FULFILLMENT_INTEGRATION === '1'

export const tokens = {
  acmeCustomer: process.env.FULFILLMENT_ACME_CUSTOMER_TOKEN ?? 'customer-acme',
  acmeOperator: process.env.FULFILLMENT_ACME_OPERATOR_TOKEN ?? 'operator-acme',
  globexCustomer: process.env.FULFILLMENT_GLOBEX_CUSTOMER_TOKEN ?? 'customer-globex',
  globexOperator: process.env.FULFILLMENT_GLOBEX_OPERATOR_TOKEN ?? 'operator-globex',
}

export const integrationReady = integrationEnabled

export interface JsonResponse {
  readonly response: Response
  readonly body: unknown
}

export async function requestJson(path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const response = await fetch(`${orchestratorUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  return { response, body: parseJson(text) }
}

export function auth(token: string | undefined): HeadersInit {
  return token === undefined ? {} : { authorization: `Bearer ${token}` }
}

export function replaceId(path: string, id: string): string {
  return path.replace(':id', encodeURIComponent(id))
}

export function parseBody<T>(body: unknown, schema: ZodType<T>): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new Error(`response did not match the contract: ${parsed.error.message}`)
  }
  return parsed.data
}

export function errorCode(body: unknown): string | undefined {
  const parsed = ErrorResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.error.code : undefined
}

export function route(path: keyof typeof fulfillmentRoutes): string {
  return fulfillmentRoutes[path]
}

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}
