import { type AnyFlow, type FlowRun, RUN_EVENT_TYPES, type RunEventType } from '@openwizard/core'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Webhook } from 'standardwebhooks'
import { validateWebhookEndpoint } from './endpoint'
import { createSubscriptionResources } from './outbound-api'
import type {
  OutboundWebhookEvent,
  OutboundWebhookEvents,
  OutboundWebhookFailureContext,
  RunWebhookAttachment,
  RunWebhookPublishInput,
  RunWebhookSubscriptions,
  RunWebhookSubscriptionsOptions,
  WebhookDelivery,
  WebhookDeliveryOptions,
  WebhookDeliveryOutcome,
  WebhookDeliverySettlement,
  WebhookPublishRejected,
  WebhookPublishResult,
  WebhookSubscriptions,
  WebhookSubscriptionsOptions,
  WebhookWorkOptions,
  WebhookWorkResult,
} from './outbound-types'

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_LEASE_MS = 30_000
const DEFAULT_PAUSED_DELAY_MS = 60_000
const DEFAULT_MAX_DELAY_MS = 24 * 60 * 60 * 1000

const TRUSTED_RUN_EVENT_SCHEMA: StandardSchemaV1<unknown, unknown> = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: '@openwizard/webhooks',
    validate: (value: unknown) => ({ value }),
  }),
})

/** Validate and retain Standard Schemas for versioned public webhook events. @public */
export function defineOutboundEvents<const E extends OutboundWebhookEvents>(events: E): E {
  const names = Object.keys(events)
  if (names.length === 0) throw new TypeError('outbound webhook events must not be empty')
  for (const name of names) {
    if (name.length === 0) throw new TypeError('outbound webhook event names must not be empty')
    const schema = events[name]
    if (!isStandardSchema(schema)) {
      throw new TypeError(`outbound webhook event '${name}' must be a Standard Schema`)
    }
  }
  return Object.freeze({ ...events }) as E
}

/** Create outbound webhooks inherited from a flow's committed event stream. @public */
export function createWebhookSubscriptions<F extends AnyFlow, P>(
  flow: F,
  options: RunWebhookSubscriptionsOptions<P>,
): RunWebhookSubscriptions<F, P>

/** Create a custom public event publisher with explicit runtime schemas. @public */
export function createWebhookSubscriptions<const E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
): WebhookSubscriptions<E, P>

export function createWebhookSubscriptions(
  flowOrOptions: unknown,
  runOptions?: unknown,
):
  | RunWebhookSubscriptions<AnyFlow, unknown>
  | WebhookSubscriptions<OutboundWebhookEvents, unknown> {
  if (runOptions !== undefined) {
    return createRunWebhookSubscriptions(
      flowOrOptions as AnyFlow,
      runOptions as RunWebhookSubscriptionsOptions<unknown>,
    )
  }
  return createSchemaWebhookSubscriptions(
    flowOrOptions as WebhookSubscriptionsOptions<OutboundWebhookEvents, unknown>,
  )
}

function createSchemaWebhookSubscriptions<const E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
): WebhookSubscriptions<E, P> {
  requireNonEmpty(options.id, 'webhook subscription id')
  const events = defineOutboundEvents(options.events)
  validateOptions(options)
  const clock = options.clock ?? (() => new Date())
  const now = (): number => {
    const value = clock().getTime()
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
  const validateEndpoint = async (
    endpoint: string,
    context: {
      readonly phase: 'create' | 'deliver' | 'update'
      readonly tenantId: string
      readonly subscriptionId?: string
    },
  ): Promise<string> => {
    const url = validateWebhookEndpoint(endpoint, {
      ...(options.endpointPolicy?.allowHTTP === undefined
        ? {}
        : { allowHTTP: options.endpointPolicy.allowHTTP }),
    })
    if (
      options.endpointPolicy?.validate !== undefined &&
      !(await options.endpointPolicy.validate({
        url,
        tenantId: context.tenantId,
        phase: context.phase,
        ...(context.subscriptionId === undefined ? {} : { subscriptionId: context.subscriptionId }),
      }))
    ) {
      throw new TypeError('webhook endpoint was rejected by the endpoint policy')
    }
    return url.href
  }
  const resources = createSubscriptionResources({
    id: options.id,
    events: Object.keys(events),
    store: options.store,
    api: options.api,
    now,
    subscriptionId: identifiers.subscription,
    secret: identifiers.secret,
    validateEndpoint: (endpoint, context) => validateEndpoint(endpoint, context),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })

  const service: WebhookSubscriptions<E, P> = {
    id: options.id,
    events,
    resources,
    publish: (event) =>
      publish(event, events, options, identifiers.event, identifiers.delivery, now),
    work: (workOptions) =>
      work(workOptions, options, identifiers.lease, now, (endpoint, context) =>
        validateEndpoint(endpoint, context),
      ),
    '~types': undefined,
  }
  return Object.freeze(service)
}

function createRunWebhookSubscriptions<F extends AnyFlow, P>(
  flow: F,
  options: RunWebhookSubscriptionsOptions<P>,
): RunWebhookSubscriptions<F, P> {
  const id = options.id ?? flow.name
  const selected = selectRunEventTypes(options.events)
  const selectedEvents: ReadonlySet<string> = new Set(selected)
  const schemas = Object.freeze(
    Object.fromEntries(selected.map((event) => [event, TRUSTED_RUN_EVENT_SCHEMA])),
  ) as OutboundWebhookEvents
  const schemaOptions: WebhookSubscriptionsOptions<OutboundWebhookEvents, P> = {
    id,
    events: schemas,
    store: options.store,
    api: {
      ...options.api,
      path: options.api.path ?? `/api/${id}/webhooks`,
    },
    ...(options.endpointPolicy === undefined ? {} : { endpointPolicy: options.endpointPolicy }),
    ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
    ...(options.identifiers === undefined ? {} : { identifiers: options.identifiers }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  }
  const base = createSchemaWebhookSubscriptions(schemaOptions)
  const runEventId = options.identifiers?.event ?? randomId
  const publishRunEvent = (input: RunWebhookPublishInput<F>): Promise<WebhookPublishResult> => {
    const invalid = validateRunPublishInput(input, selectedEvents)
    if (invalid !== undefined) return Promise.resolve(invalid)
    return base.publish({
      tenantId: input.tenantId,
      type: input.event.type,
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      subject: input.runId,
      timestamp: new Date(input.event.at),
      data: input.event,
    })
  }
  const attached = new WeakSet<object>()
  const service: RunWebhookSubscriptions<F, P> = {
    id,
    flow,
    events: selected,
    resources: base.resources,
    publish: publishRunEvent,
    attach: (run, attachOptions) => {
      if (attached.has(run)) throw new TypeError('run is already attached to these webhooks')
      attached.add(run)
      try {
        return attachRun(
          flow,
          run,
          attachOptions.tenantId,
          selected,
          runEventId,
          publishRunEvent,
          schemaOptions,
          () => attached.delete(run),
        )
      } catch (error) {
        attached.delete(run)
        throw error
      }
    },
    work: (workOptions) => base.work(workOptions),
    '~types': undefined,
  }
  return Object.freeze(service)
}

function selectRunEventTypes(
  selection: RunWebhookSubscriptionsOptions<unknown>['events'],
): readonly RunEventType[] {
  if (selection === undefined || selection === 'inherit') return RUN_EVENT_TYPES
  if (!Array.isArray(selection) || selection.length === 0) {
    throw new TypeError("run webhook events must be 'inherit' or a non-empty event list")
  }
  const available: ReadonlySet<string> = new Set(RUN_EVENT_TYPES)
  const seen = new Set<string>()
  for (const event of selection) {
    if (!available.has(event)) throw new TypeError(`unknown run event '${event}'`)
    if (seen.has(event)) throw new TypeError(`duplicate run event '${event}'`)
    seen.add(event)
  }
  return Object.freeze([...selection])
}

function attachRun<F extends AnyFlow, P>(
  flow: F,
  run: FlowRun<F>,
  tenantId: string,
  selected: readonly string[],
  eventId: () => string,
  publishRunEvent: (input: RunWebhookPublishInput<F>) => Promise<WebhookPublishResult>,
  options: WebhookSubscriptionsOptions<OutboundWebhookEvents, P>,
  release: () => void,
): RunWebhookAttachment {
  if (run.flow !== flow) throw new TypeError('run webhook flow does not match the attached run')
  requireNonEmpty(tenantId, 'run webhook tenantId')
  let disposed = false
  let pending: Promise<void> = Promise.resolve()
  let failure: unknown
  const selectedEvents: ReadonlySet<string> = new Set(selected)
  const unobserve = run.observe((event) => {
    if (!selectedEvents.has(event.type)) return
    pending = pending.then(async () => {
      let messageId: string | undefined
      try {
        messageId = requireGenerated(eventId(), 'event id')
        const result = await publishRunEvent({
          tenantId,
          runId: run.id,
          event,
          eventId: messageId,
        })
        if (!result.ok) {
          const error = new TypeError(result.message)
          failure ??= error
          await reportError(options, error, {
            operation: 'publish',
            tenantId,
            runId: run.id,
            eventType: event.type,
            eventId: messageId,
          })
        }
      } catch (error) {
        failure ??= error
        if (messageId === undefined) {
          await reportError(options, error, {
            operation: 'publish',
            tenantId,
            runId: run.id,
            eventType: event.type,
          })
        }
      }
    })
  })
  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      unobserve()
      release()
    },
    flush: async () => {
      while (true) {
        const current = pending
        await current
        if (current === pending) break
      }
      if (failure !== undefined) {
        const error = failure
        failure = undefined
        throw error
      }
    },
  })
}

function validateRunPublishInput(
  input: unknown,
  selected: ReadonlySet<string>,
): WebhookPublishRejected | undefined {
  if (!isRecord(input) || !isRecord(input.event)) {
    return rejected('WEBHOOK_EVENT_INVALID', 'run event must be an object')
  }
  const event = input.event
  if (typeof event.type !== 'string' || !selected.has(event.type)) {
    return rejected('WEBHOOK_EVENT_NOT_DECLARED', `unknown outbound event '${String(event.type)}'`)
  }
  if (!Number.isSafeInteger(event.seq) || Number(event.seq) < 0) {
    return rejected('WEBHOOK_EVENT_INVALID', 'run event seq must be a non-negative integer')
  }
  if (typeof event.at !== 'number' || !Number.isFinite(event.at)) {
    return rejected('WEBHOOK_EVENT_INVALID', 'run event at must be a finite timestamp')
  }
  if (!Array.isArray(event.path) || !event.path.every((part) => typeof part === 'string')) {
    return rejected('WEBHOOK_EVENT_INVALID', 'run event path must contain strings')
  }
  return undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function publish<E extends OutboundWebhookEvents, P>(
  event: OutboundWebhookEvent<E>,
  events: E,
  options: WebhookSubscriptionsOptions<E, P>,
  eventId: () => string,
  deliveryId: () => string,
  now: () => number,
): Promise<WebhookPublishResult> {
  if (typeof event.tenantId !== 'string' || event.tenantId.length === 0) {
    return rejected('WEBHOOK_EVENT_INVALID', 'tenantId must be a non-empty string')
  }
  if (typeof event.type !== 'string' || !Object.hasOwn(events, event.type)) {
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
  const timestamp = eventTimestamp(event.timestamp, now)
  if (timestamp === undefined) {
    return rejected('WEBHOOK_EVENT_INVALID', 'timestamp must be a valid Date or ISO 8601 string')
  }
  const schema = events[event.type]
  if (schema === undefined) {
    return rejected('WEBHOOK_EVENT_NOT_DECLARED', `unknown outbound event '${event.type}'`)
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
        ...(issue.path === undefined ? {} : { path: issue.path.map(pathKey) }),
      })),
    }
  }
  let body: string
  try {
    body = JSON.stringify({
      type: event.type,
      timestamp,
      ...(event.subject === undefined ? {} : { subject: event.subject }),
      data: parsed.value,
    })
    const roundTrip = JSON.parse(body) as Record<string, unknown>
    if (!Object.hasOwn(roundTrip, 'data'))
      throw new TypeError('event data is not JSON serializable')
  } catch (error) {
    return rejected('WEBHOOK_EVENT_NOT_SERIALIZABLE', describeError(error))
  }

  try {
    const subscriptions = await options.store.listSubscriptions({
      tenantId: event.tenantId,
      event: event.type,
      status: 'active',
    })
    const at = now()
    const deliveries: WebhookDelivery[] = subscriptions.map((subscription) => ({
      id: requireGenerated(deliveryId(), 'delivery id'),
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
    }))
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
    await reportError(options, error, {
      operation: 'publish',
      tenantId: event.tenantId,
    })
    throw error
  }
}

async function work<E extends OutboundWebhookEvents, P>(
  workOptions: WebhookWorkOptions | undefined,
  options: WebhookSubscriptionsOptions<E, P>,
  leaseId: () => string,
  now: () => number,
  validateEndpoint: (
    endpoint: string,
    context: {
      readonly phase: 'deliver'
      readonly tenantId: string
      readonly subscriptionId: string
    },
  ) => Promise<string>,
): Promise<WebhookWorkResult> {
  const limit = workOptions?.limit ?? 25
  const concurrency = workOptions?.concurrency ?? 5
  requirePositiveInteger(limit, 'work limit', 1000)
  requirePositiveInteger(concurrency, 'work concurrency', 100)
  const lease = workOptions?.leaseId ?? leaseId()
  requireNonEmpty(lease, 'worker lease id')
  const outcomes: WebhookDeliveryOutcome[] = []
  while (outcomes.length < limit) {
    const claimedAt = now()
    let deliveries: readonly WebhookDelivery[]
    try {
      deliveries = await options.store.claimDeliveries({
        now: claimedAt,
        limit: Math.min(concurrency, limit - outcomes.length),
        leaseId: lease,
        leaseExpiresAt: claimedAt + (options.delivery?.leaseMs ?? DEFAULT_LEASE_MS),
      })
    } catch (error) {
      await reportError(options, error, { operation: 'deliver' })
      throw error
    }
    if (deliveries.length === 0) break
    outcomes.push(
      ...(await concurrentMap(deliveries, concurrency, (delivery) =>
        deliver(delivery, lease, options, now, validateEndpoint),
      )),
    )
  }
  return { claimed: outcomes.length, outcomes }
}

async function deliver<E extends OutboundWebhookEvents, P>(
  delivery: WebhookDelivery,
  leaseId: string,
  options: WebhookSubscriptionsOptions<E, P>,
  now: () => number,
  validateEndpoint: (
    endpoint: string,
    context: {
      readonly phase: 'deliver'
      readonly tenantId: string
      readonly subscriptionId: string
    },
  ) => Promise<string>,
): Promise<WebhookDeliveryOutcome> {
  const context: OutboundWebhookFailureContext = {
    operation: 'deliver',
    tenantId: delivery.tenantId,
    subscriptionId: delivery.subscriptionId,
    deliveryId: delivery.id,
  }
  try {
    const subscription = await options.store.getSubscription(
      delivery.tenantId,
      delivery.subscriptionId,
    )
    if (subscription === undefined) {
      return settleFailed(delivery, leaseId, options, now(), 'subscription was deleted')
    }
    if (subscription.status === 'paused') {
      const at = now()
      const nextAttemptAt = at + (options.delivery?.pausedDelayMs ?? DEFAULT_PAUSED_DELAY_MS)
      await requireSettlement(options, delivery, leaseId, {
        kind: 'deferred',
        at,
        nextAttemptAt,
        error: 'subscription is paused',
      })
      return {
        deliveryId: delivery.id,
        subscriptionId: delivery.subscriptionId,
        status: 'deferred',
        attemptCount: delivery.attemptCount,
        nextAttemptAt,
        error: 'subscription is paused',
      }
    }
    if (subscription.status === 'disabled') {
      return settleFailed(delivery, leaseId, options, now(), 'subscription is disabled')
    }

    let endpoint: string
    try {
      endpoint = await validateEndpoint(delivery.endpoint, {
        phase: 'deliver',
        tenantId: delivery.tenantId,
        subscriptionId: delivery.subscriptionId,
      })
    } catch (error) {
      const message = `endpoint rejected before delivery: ${describeError(error)}`
      await disableSubscription(options, delivery, now(), message)
      return settleFailed(delivery, leaseId, options, now(), message)
    }

    const attempt = delivery.attemptCount + 1
    const attemptAt = now()
    const date = new Date(attemptAt)
    let signature: string
    try {
      signature = new Webhook(delivery.secret).sign(delivery.messageId, date, delivery.body)
    } catch (error) {
      const message = `signing failed: ${describeError(error)}`
      return settleFailed(delivery, leaseId, options, attemptAt, message, attempt)
    }

    let response: Response
    try {
      response = await sendRequest(endpoint, delivery, signature, date, options.delivery)
    } catch (error) {
      const message = describeDeliveryError(error)
      return retryOrFail(delivery, leaseId, options, now(), attempt, message)
    }
    try {
      await response.body?.cancel()
    } catch {
      // The status and headers are enough to settle this attempt.
    }
    const completedAt = now()
    if (response.status >= 200 && response.status < 300) {
      await requireSettlement(options, delivery, leaseId, {
        kind: 'succeeded',
        at: completedAt,
        attemptCount: attempt,
        responseStatus: response.status,
      })
      return {
        deliveryId: delivery.id,
        subscriptionId: delivery.subscriptionId,
        status: 'succeeded',
        attemptCount: attempt,
        responseStatus: response.status,
      }
    }
    if (response.status === 410) {
      const message = 'endpoint returned HTTP 410 Gone'
      await disableSubscription(options, delivery, completedAt, message)
      return settleFailed(
        delivery,
        leaseId,
        options,
        completedAt,
        message,
        attempt,
        response.status,
      )
    }
    const message = `endpoint returned HTTP ${response.status}`
    return transientStatus(response.status)
      ? retryOrFail(
          delivery,
          leaseId,
          options,
          completedAt,
          attempt,
          message,
          response.status,
          retryAfter(response.headers.get('retry-after'), completedAt, options.delivery),
        )
      : settleFailed(delivery, leaseId, options, completedAt, message, attempt, response.status)
  } catch (error) {
    await reportError(options, error, context)
    throw error
  }
}

async function sendRequest(
  endpoint: string,
  delivery: WebhookDelivery,
  signature: string,
  date: Date,
  deliveryOptions: WebhookDeliveryOptions | undefined,
): Promise<Response> {
  const fetcher = deliveryOptions?.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new TypeError('this runtime does not provide fetch')
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('webhook delivery timed out')),
    deliveryOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  try {
    return await fetcher(endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      body: delivery.body,
      headers: {
        'content-type': 'application/json',
        'user-agent': '@openwizard/webhooks',
        'webhook-id': delivery.messageId,
        'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
        'webhook-signature': signature,
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function retryOrFail<E extends OutboundWebhookEvents, P>(
  delivery: WebhookDelivery,
  leaseId: string,
  options: WebhookSubscriptionsOptions<E, P>,
  at: number,
  attempt: number,
  error: string,
  responseStatus?: number,
  retryAt?: number,
): Promise<WebhookDeliveryOutcome> {
  const maxAttempts = options.delivery?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (attempt >= maxAttempts) {
    if (options.delivery?.disableOnExhaustion !== false) {
      await disableSubscription(options, delivery, at, `delivery retries exhausted: ${error}`)
    }
    return settleFailed(delivery, leaseId, options, at, error, attempt, responseStatus)
  }
  const nextAttemptAt = retryAt ?? at + backoffDelay(options.delivery, attempt)
  const settlement: WebhookDeliverySettlement = {
    kind: 'retry',
    at,
    attemptCount: attempt,
    nextAttemptAt,
    error,
    ...(responseStatus === undefined ? {} : { responseStatus }),
  }
  await requireSettlement(options, delivery, leaseId, settlement)
  return {
    deliveryId: delivery.id,
    subscriptionId: delivery.subscriptionId,
    status: 'retrying',
    attemptCount: attempt,
    nextAttemptAt,
    error,
    ...(responseStatus === undefined ? {} : { responseStatus }),
  }
}

async function settleFailed<E extends OutboundWebhookEvents, P>(
  delivery: WebhookDelivery,
  leaseId: string,
  options: WebhookSubscriptionsOptions<E, P>,
  at: number,
  error: string,
  attemptCount = delivery.attemptCount,
  responseStatus?: number,
): Promise<WebhookDeliveryOutcome> {
  const settlement: WebhookDeliverySettlement = {
    kind: 'failed',
    at,
    attemptCount,
    error,
    ...(responseStatus === undefined ? {} : { responseStatus }),
  }
  await requireSettlement(options, delivery, leaseId, settlement)
  return {
    deliveryId: delivery.id,
    subscriptionId: delivery.subscriptionId,
    status: 'failed',
    attemptCount,
    error,
    ...(responseStatus === undefined ? {} : { responseStatus }),
  }
}

async function requireSettlement<E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
  delivery: WebhookDelivery,
  leaseId: string,
  settlement: WebhookDeliverySettlement,
): Promise<void> {
  if (!(await options.store.settleDelivery(delivery.id, leaseId, settlement))) {
    throw new Error(`delivery lease '${leaseId}' no longer owns '${delivery.id}'`)
  }
}

async function disableSubscription<E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
  delivery: WebhookDelivery,
  at: number,
  reason: string,
): Promise<void> {
  await options.store.updateSubscription(delivery.tenantId, delivery.subscriptionId, {
    status: 'disabled',
    disabledReason: reason,
    updatedAt: at,
  })
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function retryAfter(
  value: string | null,
  now: number,
  options: WebhookDeliveryOptions | undefined,
): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  const raw = Number.isFinite(seconds) ? now + Math.max(0, seconds * 1000) : Date.parse(value)
  if (!Number.isFinite(raw)) return undefined
  return Math.min(Math.max(raw, now), now + (options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS))
}

function backoffDelay(options: WebhookDeliveryOptions | undefined, attempt: number): number {
  const configured = options?.backoff
  let delay: number
  if (typeof configured === 'number') delay = configured
  else if (typeof configured === 'function') delay = configured(attempt)
  else if (Array.isArray(configured)) {
    delay = configured[Math.min(attempt - 1, configured.length - 1)] ?? 0
  } else delay = 30_000 * 2 ** Math.min(attempt - 1, 10)
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError('webhook delivery backoff must return a non-negative finite number')
  }
  return Math.min(delay, options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS)
}

function eventTimestamp(value: Date | string | undefined, now: () => number): string | undefined {
  const date =
    value === undefined ? new Date(now()) : value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function rejected(code: WebhookPublishRejected['code'], message: string): WebhookPublishRejected {
  return { ok: false, code, message }
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    '~standard' in value &&
    typeof value['~standard'] === 'object' &&
    value['~standard'] !== null &&
    'validate' in value['~standard'] &&
    typeof value['~standard'].validate === 'function'
  )
}

function pathKey(segment: PropertyKey | StandardSchemaV1.PathSegment): PropertyKey {
  return typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment
}

function validateOptions<E extends OutboundWebhookEvents, P>(
  options: WebhookSubscriptionsOptions<E, P>,
): void {
  const documentation = options.api.auth.documentation
  requireNonEmpty(documentation.schemeName, 'scope-provider scheme name')
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(documentation.schemeName)) {
    throw new TypeError('scope-provider scheme name must be an OpenAPI component name')
  }
  if (
    typeof documentation.securityScheme !== 'object' ||
    documentation.securityScheme === null ||
    typeof documentation.securityScheme.type !== 'string'
  ) {
    throw new TypeError('scope-provider securityScheme must declare its OpenAPI type')
  }
  for (const scope of [...(options.api.scopes?.read ?? []), ...(options.api.scopes?.write ?? [])]) {
    if (typeof scope !== 'string' || scope.length === 0) {
      throw new TypeError('subscription API scopes must be non-empty strings')
    }
  }
  requireOptionalPositiveInteger(options.api.maxBodyBytes, 'api.maxBodyBytes')
  requireOptionalPositiveInteger(options.delivery?.maxAttempts, 'delivery.maxAttempts')
  requireOptionalPositiveInteger(options.delivery?.timeoutMs, 'delivery.timeoutMs')
  requireOptionalPositiveInteger(options.delivery?.leaseMs, 'delivery.leaseMs')
  requireOptionalPositiveInteger(options.delivery?.pausedDelayMs, 'delivery.pausedDelayMs')
  requireOptionalPositiveInteger(options.delivery?.maxDelayMs, 'delivery.maxDelayMs')
  const timeoutMs = options.delivery?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const leaseMs = options.delivery?.leaseMs ?? DEFAULT_LEASE_MS
  if (leaseMs <= timeoutMs) {
    throw new TypeError('delivery.leaseMs must be greater than delivery.timeoutMs')
  }
  if (
    typeof options.delivery?.backoff === 'number' &&
    (!Number.isFinite(options.delivery.backoff) || options.delivery.backoff < 0)
  ) {
    throw new TypeError('delivery.backoff must be a non-negative finite number')
  }
  if (
    Array.isArray(options.delivery?.backoff) &&
    (options.delivery.backoff.length === 0 ||
      options.delivery.backoff.some((delay) => !Number.isFinite(delay) || delay < 0))
  ) {
    throw new TypeError('delivery.backoff delays must be non-negative finite numbers')
  }
}

async function concurrentMap<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length)
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index++
      const value = values[current]
      if (value !== undefined) results[current] = await map(value)
    }
  })
  await Promise.all(workers)
  return results
}

async function reportError<E extends OutboundWebhookEvents, P>(
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

function describeDeliveryError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'webhook delivery timed out'
  return describeError(error)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new TypeError('webhook ids require crypto.randomUUID or an injected identifier')
  }
  return globalThis.crypto.randomUUID()
}

function randomSecret(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new TypeError('webhook secrets require crypto.getRandomValues or an injected generator')
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `whsec_${btoa(binary)}`
}

function validSecret(secret: string): string {
  requireNonEmpty(secret, 'generated webhook secret')
  try {
    new Webhook(secret)
  } catch (error) {
    throw new TypeError(`generated webhook secret is invalid: ${describeError(error)}`)
  }
  return secret
}

function requireGenerated(value: string, label: string): string {
  requireNonEmpty(value, `generated ${label}`)
  return value
}

function requireNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${label} must not be empty`)
}

function requirePositiveInteger(value: number, label: string, maximum?: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    throw new TypeError(
      `${label} must be a positive safe integer${maximum === undefined ? '' : ` no greater than ${maximum}`}`,
    )
  }
}

function requireOptionalPositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined) requirePositiveInteger(value, label)
}
