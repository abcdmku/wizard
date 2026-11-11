import type { StandardSchemaV1 } from '@standard-schema/spec'
import { validateProvider, validateScopes } from './auth'
import { validateWebhookEndpoint } from './endpoint'
import { requireNonEmpty, requirePositiveInteger } from './http-response'
import { isStandardSchema } from './json-schema'
import { normalizePrefix } from './naming'
import { type DeliveryContext, work } from './outbound-delivery'
import { subscriptionComponents } from './outbound-openapi'
import { createSubscriptionResources, type SubscriptionAPI } from './outbound-routes'
import type {
  OutboundWebhookEvent,
  OutboundWebhookEvents,
  OutboundWebhookFailureContext,
  WebhookDelivery,
  WebhookPublishRejected,
  WebhookPublishResult,
  WebhookSubscriptions,
  WebhookSubscriptionsOptions,
} from './outbound-types'
import { secretBytes } from './signature'

/**
 * Outbound webhooks for a declared set of public events: `publish` fans an event out to the
 * tenant's active subscriptions through the durable queue, `work` delivers it signed (Standard
 * Webhooks), and the routes let tenants manage their subscriptions and read the delivery log.
 * @public
 */
export function createWebhookSubscriptions<const E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
): WebhookSubscriptions<E, P> {
  const events = validateOptions(options)
  const now = (): number => {
    const value = (options.clock ?? (() => new Date()))().getTime()
    if (!Number.isFinite(value)) throw new TypeError('webhook clock must return a valid Date')
    return value
  }
  const identifiers = {
    subscription: options.identifiers?.subscription ?? randomId,
    event: options.identifiers?.event ?? randomId,
    delivery: options.identifiers?.delivery ?? randomId,
    lease: options.identifiers?.lease ?? randomId,
    secret: () => validSecret((options.identifiers?.secret ?? randomSecret)()),
  }
  const validateEndpoint: DeliveryContext['validateEndpoint'] = async (endpoint, context) => {
    const url = validateWebhookEndpoint(
      endpoint,
      options.endpointPolicy?.allowHTTP === undefined
        ? {}
        : { allowHTTP: options.endpointPolicy.allowHTTP },
    )
    if (
      options.endpointPolicy?.validate !== undefined &&
      !(await options.endpointPolicy.validate({ url, ...context }))
    ) {
      throw new TypeError('webhook endpoint was rejected by the endpoint policy')
    }
    return url.href
  }
  const api: SubscriptionAPI<P> = {
    id: options.id,
    events,
    store: options.store,
    auth: options.auth,
    authorize: options.authorize,
    basePath: normalizePrefix(options.path ?? `/subscriptions/${options.id}`, 'path'),
    scopes: {
      read: validateScopes(options.scopes?.read ?? [`${options.id}:webhooks:read`], 'scopes.read'),
      write: validateScopes(
        options.scopes?.write ?? [`${options.id}:webhooks:write`],
        'scopes.write',
      ),
    },
    maxBodyBytes: options.maxBodyBytes ?? 65_536,
    now,
    subscriptionId: identifiers.subscription,
    secret: identifiers.secret,
    validateEndpoint,
    onError: options.onError,
  }
  const delivery: DeliveryContext = {
    store: options.store,
    delivery: options.delivery ?? {},
    now,
    leaseId: identifiers.lease,
    validateEndpoint,
    report: (error, context) => report(options, error, context),
  }
  const subscriptions: WebhookSubscriptions<E, P> = {
    id: options.id,
    events: options.events,
    resources: createSubscriptionResources(api),
    openAPIComponents: subscriptionComponents(api, options.events),
    publish: (event) => publish(event, options, identifiers.event, identifiers.delivery, now),
    work: (workOptions) => work(delivery, workOptions),
    '~types': undefined,
  }
  return Object.freeze(subscriptions)
}

async function publish<E extends OutboundWebhookEvents, P>(
  event: OutboundWebhookEvent<E>,
  options: WebhookSubscriptionsOptions<E, P>,
  eventId: () => string,
  deliveryId: () => string,
  now: () => number,
): Promise<WebhookPublishResult> {
  if (typeof event.tenantId !== 'string' || event.tenantId.length === 0) {
    return rejected('WEBHOOK_EVENT_INVALID', 'tenantId must be a non-empty string')
  }
  const schema: StandardSchemaV1 | undefined = Object.hasOwn(options.events, event.type)
    ? options.events[event.type]
    : undefined
  if (schema === undefined) {
    return rejected('WEBHOOK_EVENT_NOT_DECLARED', `unknown outbound event '${String(event.type)}'`)
  }
  if (
    event.subject !== undefined &&
    (typeof event.subject !== 'string' || event.subject.length === 0)
  ) {
    return rejected('WEBHOOK_EVENT_INVALID', 'subject must be a non-empty string when supplied')
  }
  const messageId = event.eventId ?? eventId()
  if (typeof messageId !== 'string' || messageId.length === 0) {
    return rejected('WEBHOOK_EVENT_INVALID', 'eventId must be a non-empty string')
  }
  const date = event.timestamp === undefined ? new Date(now()) : new Date(event.timestamp)
  if (!Number.isFinite(date.getTime())) {
    return rejected('WEBHOOK_EVENT_INVALID', 'timestamp must be a valid Date or ISO 8601 string')
  }
  let parsed: StandardSchemaV1.Result<unknown>
  try {
    parsed = await schema['~standard'].validate(event.data)
  } catch (error) {
    return rejected('WEBHOOK_EVENT_INVALID', describeError(error))
  }
  if (parsed.issues !== undefined) {
    return {
      ok: false,
      code: 'WEBHOOK_EVENT_INVALID',
      message: `data for '${event.type}' failed its public event schema`,
      issues: parsed.issues.map((issue) => ({
        message: issue.message,
        ...(issue.path === undefined
          ? {}
          : {
              path: issue.path.map((segment) =>
                typeof segment === 'object' ? segment.key : segment,
              ),
            }),
      })),
    }
  }
  const body = serialize({
    type: event.type,
    timestamp: date.toISOString(),
    ...(event.subject === undefined ? {} : { subject: event.subject }),
    data: parsed.value,
  })
  if (body === undefined) {
    return rejected('WEBHOOK_EVENT_NOT_SERIALIZABLE', `data for '${event.type}' is not JSON`)
  }
  try {
    const subscriptions = await options.store.listSubscriptions({
      tenantId: event.tenantId,
      event: event.type,
      status: 'active',
    })
    const at = now()
    const deliveries = subscriptions.map(
      (subscription): WebhookDelivery => ({
        id: requireNonEmpty(deliveryId(), 'generated delivery id'),
        messageId,
        tenantId: event.tenantId,
        subscriptionId: subscription.id,
        eventType: event.type,
        endpoint: subscription.endpoint,
        body,
        secret: subscription.secret,
        status: 'queued',
        attemptCount: 0,
        nextAttemptAt: at,
        createdAt: at,
        updatedAt: at,
      }),
    )
    const enqueued = await options.store.enqueueDeliveries(deliveries)
    return {
      ok: true,
      eventId: messageId,
      matchedSubscriptions: subscriptions.length,
      enqueuedDeliveries: enqueued.enqueued.length,
      duplicateDeliveries: enqueued.duplicateCount,
      deliveryIds: enqueued.enqueued.map((delivery) => delivery.id),
    }
  } catch (error) {
    await report(options, error, {
      operation: 'publish',
      tenantId: event.tenantId,
      eventType: event.type,
      eventId: messageId,
    })
    throw error
  }
}

/** Check every option at construction; returns the declared event names. */
function validateOptions<E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
): readonly string[] {
  requireNonEmpty(options.id, 'webhook subscriptions id')
  const events = Object.keys(options.events)
  if (events.length === 0) throw new TypeError('outbound webhook events must not be empty')
  for (const name of events) {
    if (!isStandardSchema(options.events[name])) {
      throw new TypeError(`outbound webhook event '${name}' must be a Standard Schema`)
    }
  }
  validateProvider(options.auth)
  requirePositiveInteger(options.maxBodyBytes, 'maxBodyBytes')
  const delivery = options.delivery ?? {}
  for (const key of [
    'maxAttempts',
    'timeoutMs',
    'leaseMs',
    'pausedDelayMs',
    'maxDelayMs',
  ] as const) {
    requirePositiveInteger(delivery[key], `delivery.${key}`)
  }
  if ((delivery.leaseMs ?? 30_000) <= (delivery.timeoutMs ?? 10_000)) {
    throw new TypeError('delivery.leaseMs must be greater than delivery.timeoutMs')
  }
  const delays = typeof delivery.backoff === 'number' ? [delivery.backoff] : delivery.backoff
  if (
    Array.isArray(delays) &&
    (delays.length === 0 || delays.some((delay) => !Number.isFinite(delay) || delay < 0))
  ) {
    throw new TypeError('delivery.backoff delays must be non-negative finite numbers')
  }
  return events
}

async function report<E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
  error: unknown,
  context: OutboundWebhookFailureContext,
): Promise<void> {
  try {
    await options.onError?.(error, context)
  } catch {
    // An observer cannot replace the original failure.
  }
}

/** The exact JSON body every delivery reuses, or `undefined` when `data` does not survive JSON. */
function serialize(envelope: Readonly<Record<string, unknown>>): string | undefined {
  try {
    const body = JSON.stringify(envelope)
    return Object.hasOwn(JSON.parse(body), 'data') ? body : undefined
  } catch {
    return undefined
  }
}

function rejected(code: WebhookPublishRejected['code'], message: string): WebhookPublishRejected {
  return { ok: false, code, message }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function randomId(): string {
  return crypto.randomUUID()
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${btoa(String.fromCharCode(...bytes))}`
}

function validSecret(secret: string): string {
  secretBytes(requireNonEmpty(secret, 'generated webhook secret'))
  return secret
}
