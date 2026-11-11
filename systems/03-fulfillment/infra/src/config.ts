import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()

export const settings = {
  partnerApiBaseUrl: withoutTrailingSlash(
    config.get('partnerApiBaseUrl') ?? 'http://partner-api:3002',
  ),
  orchestrationCallbackUrl:
    config.get('orchestrationCallbackUrl') ?? 'http://orchestrator:3001/api/webhooks/partner',
  partnerWebhookSecret: pulumi.secret(
    config.get('partnerWebhookSecret') ?? 'local-partner-webhook-secret',
  ),
  requestTimeoutMilliseconds: integerConfig('requestTimeoutMilliseconds', 8000, 100, 30_000),
  lambdaTimeoutSeconds: integerConfig('lambdaTimeoutSeconds', 15, 1, 900),
  queueVisibilityTimeoutSeconds: integerConfig('queueVisibilityTimeoutSeconds', 120, 1, 43_200),
  maxReceiveCount: integerConfig('maxReceiveCount', 5, 1, 1000),
}

if (settings.queueVisibilityTimeoutSeconds < settings.lambdaTimeoutSeconds * 6) {
  throw new Error('queueVisibilityTimeoutSeconds must be at least six times lambdaTimeoutSeconds')
}

function integerConfig(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = config.getNumber(name) ?? fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
