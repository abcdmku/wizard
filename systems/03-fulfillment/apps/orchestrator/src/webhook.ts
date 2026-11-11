import { createHash } from 'node:crypto'
import {
  type PartnerCallback,
  PartnerCallbackSchema,
  type PartnerIdentity,
  PartnerIdentitySchema,
} from '@fulfillment/contracts'
import { verifyWebhookSignature } from '@fulfillment/contracts/signing'
import { FulfillmentServiceError } from './errors'

interface WebhookHeaders {
  readonly partner: string | string[] | undefined
  readonly timestamp: string | string[] | undefined
  readonly signature: string | string[] | undefined
}

export interface VerifiedPartnerDelivery {
  readonly partner: PartnerIdentity
  readonly callback: PartnerCallback
  readonly digest: string
}

export function verifyPartnerDelivery(
  rawBody: string,
  headers: WebhookHeaders,
  secrets: Readonly<Record<PartnerIdentity, string>>,
  now = Date.now(),
): VerifiedPartnerDelivery {
  const partner = PartnerIdentitySchema.parse(headers.partner)
  const timestamp = single(headers.timestamp, 'x-fulfillment-timestamp')
  const signature = single(headers.signature, 'x-fulfillment-signature')
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds) || Math.abs(now - seconds * 1_000) > 5 * 60_000) {
    throw new FulfillmentServiceError('UNAUTHENTICATED', 'Webhook timestamp is stale', 401)
  }
  if (!verifyWebhookSignature(secrets[partner], timestamp, rawBody, signature)) {
    throw new FulfillmentServiceError('UNAUTHENTICATED', 'Webhook signature is invalid', 401)
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(rawBody)
  } catch {
    throw new FulfillmentServiceError('INVALID_OPERATION', 'Webhook body is not valid JSON', 400)
  }
  return {
    partner,
    callback: PartnerCallbackSchema.parse(decoded),
    digest: createHash('sha256').update(rawBody).digest('hex'),
  }
}

function single(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FulfillmentServiceError('UNAUTHENTICATED', `${name} is required`, 401)
  }
  return value
}
