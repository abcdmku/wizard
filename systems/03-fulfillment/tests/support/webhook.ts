import type { PartnerCallback, PartnerIdentity } from '@fulfillment/contracts'
import { signWebhook } from '@fulfillment/contracts/signing'

export const webhookSecret =
  process.env.FULFILLMENT_PARTNER_WEBHOOK_SECRET ?? 'local-partner-webhook-secret'

export function signedHeaders(
  body: string,
  partner: PartnerIdentity = 'shipping',
  timestamp = Math.floor(Date.now() / 1_000),
): HeadersInit {
  const timestampText = String(timestamp)
  return {
    'content-type': 'application/json',
    'x-partner-id': partner,
    'x-fulfillment-timestamp': timestampText,
    'x-fulfillment-signature': signWebhook(webhookSecret, timestampText, body),
  }
}

export function rawCallback(callback: PartnerCallback): string {
  return JSON.stringify(callback)
}
