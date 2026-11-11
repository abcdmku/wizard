import { createHmac, timingSafeEqual } from 'node:crypto'

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return `v1=${digest}`
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
