import { requireNonEmpty } from './http-response'
import type {
  OutboundWebhookFailureContext,
  WebhookDelivery,
  WebhookDeliveryOptions,
  WebhookDeliveryOutcome,
  WebhookDeliverySettlement,
  WebhookStore,
  WebhookWorkOptions,
  WebhookWorkResult,
} from './outbound-types'
import { signWebhook, type WebhookSignatureHeaders } from './signature'

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_LEASE_MS = 30_000
const DEFAULT_PAUSED_DELAY_MS = 60_000
const DEFAULT_MAX_DELAY_MS = 24 * 60 * 60 * 1000

/** What the worker needs, resolved once by `createWebhookSubscriptions`. */
export interface DeliveryContext {
  readonly store: WebhookStore
  readonly delivery: WebhookDeliveryOptions
  readonly now: () => number
  readonly leaseId: () => string
  /** The endpoint policy; throws a `TypeError` for an endpoint it rejects. */
  readonly validateEndpoint: (
    endpoint: string,
    context: {
      readonly phase: 'create' | 'deliver' | 'update'
      readonly tenantId: string
      readonly subscriptionId?: string
    },
  ) => Promise<string>
  readonly report: (error: unknown, context: OutboundWebhookFailureContext) => Promise<void>
}

/** Claim due deliveries under one lease and attempt them, `concurrency` at a time. */
export async function work(
  context: DeliveryContext,
  options: WebhookWorkOptions = {},
): Promise<WebhookWorkResult> {
  const limit = options.limit ?? 25
  const concurrency = options.concurrency ?? 5
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
    throw new TypeError('work limit must be a positive safe integer no greater than 1000')
  }
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0 || concurrency > 100) {
    throw new TypeError('work concurrency must be a positive safe integer no greater than 100')
  }
  const lease = requireNonEmpty(options.leaseId ?? context.leaseId(), 'worker lease id')
  const outcomes: WebhookDeliveryOutcome[] = []
  while (outcomes.length < limit) {
    const claimedAt = context.now()
    let deliveries: readonly WebhookDelivery[]
    try {
      deliveries = await context.store.claimDeliveries({
        now: claimedAt,
        limit: Math.min(concurrency, limit - outcomes.length),
        leaseId: lease,
        leaseExpiresAt: claimedAt + (context.delivery.leaseMs ?? DEFAULT_LEASE_MS),
      })
    } catch (error) {
      await context.report(error, { operation: 'deliver' })
      throw error
    }
    if (deliveries.length === 0) break
    outcomes.push(
      ...(await concurrentMap(deliveries, concurrency, (d) => deliver(context, d, lease))),
    )
  }
  return { claimed: outcomes.length, outcomes }
}

async function deliver(
  context: DeliveryContext,
  delivery: WebhookDelivery,
  leaseId: string,
): Promise<WebhookDeliveryOutcome> {
  const settle = settlement(context, delivery, leaseId)
  try {
    const subscription = await context.store.getSubscription(
      delivery.tenantId,
      delivery.subscriptionId,
    )
    if (subscription === undefined) return settle.failed(context.now(), 'subscription was deleted')
    if (subscription.status === 'disabled')
      return settle.failed(context.now(), 'subscription is disabled')
    if (subscription.status === 'paused')
      return settle.deferred(context.now(), 'subscription is paused')
    let endpoint: string
    try {
      endpoint = await context.validateEndpoint(delivery.endpoint, {
        phase: 'deliver',
        tenantId: delivery.tenantId,
        subscriptionId: delivery.subscriptionId,
      })
    } catch (error) {
      const message = `endpoint rejected before delivery: ${describeError(error)}`
      await disable(context, delivery, context.now(), message)
      return settle.failed(context.now(), message)
    }
    const attempt = delivery.attemptCount + 1
    let signature: WebhookSignatureHeaders
    try {
      signature = await signWebhook({
        secret: delivery.secret,
        id: delivery.messageId,
        body: delivery.body,
        timestamp: new Date(context.now()),
      })
    } catch (error) {
      return settle.failed(context.now(), `signing failed: ${describeError(error)}`, attempt)
    }
    let response: Response
    try {
      response = await post(context, endpoint, delivery, signature)
    } catch (error) {
      return retryOrFail(
        context,
        settle,
        delivery,
        context.now(),
        attempt,
        describeDeliveryError(error),
      )
    }
    await response.body?.cancel().catch(() => {})
    const at = context.now()
    if (response.ok) return settle.succeeded(at, attempt, response.status)
    if (response.status === 410) {
      const message = 'endpoint returned HTTP 410 Gone'
      await disable(context, delivery, at, message)
      return settle.failed(at, message, attempt, response.status)
    }
    const message = `endpoint returned HTTP ${response.status}`
    return transientStatus(response.status)
      ? retryOrFail(
          context,
          settle,
          delivery,
          at,
          attempt,
          message,
          response.status,
          retryAfter(response.headers.get('retry-after'), at, context.delivery),
        )
      : settle.failed(at, message, attempt, response.status)
  } catch (error) {
    await context.report(error, {
      operation: 'deliver',
      tenantId: delivery.tenantId,
      subscriptionId: delivery.subscriptionId,
      deliveryId: delivery.id,
    })
    throw error
  }
}

/** One POST of the stored body with its signature headers, under a timeout. */
async function post(
  context: DeliveryContext,
  endpoint: string,
  delivery: WebhookDelivery,
  headers: WebhookSignatureHeaders,
): Promise<Response> {
  const fetcher = context.delivery.fetch ?? globalThis.fetch
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('webhook delivery timed out')),
    context.delivery.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  try {
    return await fetcher(endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      body: delivery.body,
      headers: { 'content-type': 'application/json', 'user-agent': '@openwizard/http', ...headers },
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** Compare-and-set writers for one claimed delivery; a lost lease throws. */
function settlement(context: DeliveryContext, delivery: WebhookDelivery, leaseId: string) {
  const outcome = (
    status: WebhookDeliveryOutcome['status'],
    fields: Partial<WebhookDeliveryOutcome>,
  ) => ({
    deliveryId: delivery.id,
    subscriptionId: delivery.subscriptionId,
    status,
    attemptCount: delivery.attemptCount,
    ...fields,
  })
  const write = async (value: WebhookDeliverySettlement): Promise<void> => {
    if (!(await context.store.settleDelivery(delivery.id, leaseId, value))) {
      throw new Error(`delivery lease '${leaseId}' no longer owns '${delivery.id}'`)
    }
  }
  const status = (responseStatus: number | undefined) =>
    responseStatus === undefined ? {} : { responseStatus }
  return {
    async failed(
      at: number,
      error: string,
      attemptCount = delivery.attemptCount,
      responseStatus?: number,
    ) {
      await write({ kind: 'failed', at, attemptCount, error, ...status(responseStatus) })
      return outcome('failed', { attemptCount, error, ...status(responseStatus) })
    },
    async deferred(at: number, error: string) {
      const nextAttemptAt = at + (context.delivery.pausedDelayMs ?? DEFAULT_PAUSED_DELAY_MS)
      await write({ kind: 'deferred', at, nextAttemptAt, error })
      return outcome('deferred', { nextAttemptAt, error })
    },
    async retry(
      at: number,
      attemptCount: number,
      nextAttemptAt: number,
      error: string,
      responseStatus?: number,
    ) {
      await write({
        kind: 'retry',
        at,
        attemptCount,
        nextAttemptAt,
        error,
        ...status(responseStatus),
      })
      return outcome('retrying', { attemptCount, nextAttemptAt, error, ...status(responseStatus) })
    },
    async succeeded(at: number, attemptCount: number, responseStatus: number) {
      await write({ kind: 'succeeded', at, attemptCount, responseStatus })
      return outcome('succeeded', { attemptCount, responseStatus })
    },
  }
}

async function retryOrFail(
  context: DeliveryContext,
  settle: ReturnType<typeof settlement>,
  delivery: WebhookDelivery,
  at: number,
  attempt: number,
  error: string,
  responseStatus?: number,
  retryAt?: number,
): Promise<WebhookDeliveryOutcome> {
  if (attempt >= (context.delivery.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
    if (context.delivery.disableOnExhaustion !== false) {
      await disable(context, delivery, at, `delivery retries exhausted: ${error}`)
    }
    return settle.failed(at, error, attempt, responseStatus)
  }
  const nextAttemptAt = retryAt ?? at + backoffDelay(context.delivery, attempt)
  return settle.retry(at, attempt, nextAttemptAt, error, responseStatus)
}

async function disable(
  context: DeliveryContext,
  delivery: WebhookDelivery,
  at: number,
  reason: string,
) {
  await context.store.updateSubscription(delivery.tenantId, delivery.subscriptionId, {
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
  options: WebhookDeliveryOptions,
): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  const raw = Number.isFinite(seconds) ? now + Math.max(0, seconds * 1000) : Date.parse(value)
  if (!Number.isFinite(raw)) return undefined
  return Math.min(Math.max(raw, now), now + (options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS))
}

function backoffDelay(options: WebhookDeliveryOptions, attempt: number): number {
  const configured = options.backoff
  const delay =
    typeof configured === 'number'
      ? configured
      : typeof configured === 'function'
        ? configured(attempt)
        : Array.isArray(configured)
          ? (configured[Math.min(attempt - 1, configured.length - 1)] ?? 0)
          : 30_000 * 2 ** Math.min(attempt - 1, 10)
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError('webhook delivery backoff must return a non-negative finite number')
  }
  return Math.min(delay, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS)
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

function describeDeliveryError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'webhook delivery timed out'
  return describeError(error)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
