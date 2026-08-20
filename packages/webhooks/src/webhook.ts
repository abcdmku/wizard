import type { AnyFlow, EventType, SendResult } from '@openwizard/core'
import { Webhook, WebhookVerificationError } from 'standardwebhooks'
import { createOpenAPIOperation } from './openapi'
import type {
  AnyWebhookResource,
  StandardWebhookEnvelope,
  VerifiedWebhookDelivery,
  WebhookFailureContext,
  WebhookResource,
  WebhookResourceOptions,
  WebhookSignatureContext,
} from './types'

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

/** Define a signed Standard Webhooks receiver for one event declared by an OpenWizard flow. @public */
export function defineWebhook<F extends AnyFlow, E extends EventType<F>>(
  options: WebhookResourceOptions<F, E>,
): WebhookResource<F, E> {
  const event = options.event
  const id = options.id ?? event
  const path = options.path ?? `/webhooks/${event}`
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  requireNonEmpty(id, 'webhook resource id')
  requireNonEmpty(event, 'webhook event')
  requirePath(path)
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError('maxBodyBytes must be a positive safe integer')
  }

  const resource: WebhookResource<F, E> = {
    id,
    event,
    path,
    method: 'POST',
    flow: options.flow,
    openAPI: createOpenAPIOperation(event, options.documentation),
    handle: (request) => receive(request, options, event, maxBodyBytes),
  }
  return Object.freeze(resource)
}

/** Validate and retain a webhook collection for Nitro registration. @public */
export function defineWebhooks<const R extends readonly AnyWebhookResource[]>(resources: R): R {
  const ids = new Set<string>()
  const routes = new Set<string>()
  for (const resource of resources) {
    if (ids.has(resource.id)) throw new TypeError(`duplicate webhook resource id '${resource.id}'`)
    const route = `${resource.method} ${resource.path}`
    if (routes.has(route)) throw new TypeError(`duplicate webhook route '${route}'`)
    ids.add(resource.id)
    routes.add(route)
  }
  return Object.freeze([...resources]) as unknown as R
}

async function receive<F extends AnyFlow, E extends EventType<F>>(
  request: Request,
  options: WebhookResourceOptions<F, E>,
  event: E,
  maxBodyBytes: number,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return json(405, errorBody('WEBHOOK_METHOD_NOT_ALLOWED', 'webhooks require POST'), {
      allow: 'POST',
    })
  }
  if (!isJson(request.headers.get('content-type'))) {
    return json(
      415,
      errorBody('WEBHOOK_UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json'),
    )
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBodyBytes) {
    return json(413, errorBody('WEBHOOK_BODY_TOO_LARGE', 'webhook body exceeds its size limit'))
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch (error) {
    return unexpected(error, request, event, options)
  }
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) {
    return json(413, errorBody('WEBHOOK_BODY_TOO_LARGE', 'webhook body exceeds its size limit'))
  }

  const signatureContext = signatureContextOf(request)
  let secret: string
  try {
    secret =
      typeof options.secret === 'string' ? options.secret : await options.secret(signatureContext)
  } catch (error) {
    return unexpected(error, request, event, options)
  }

  let verified: unknown
  try {
    verified = new Webhook(secret).verify(rawBody, Object.fromEntries(request.headers.entries()))
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return json(
        401,
        errorBody('WEBHOOK_INVALID_SIGNATURE', 'webhook signature verification failed'),
      )
    }
    if (error instanceof SyntaxError) {
      return json(400, errorBody('WEBHOOK_INVALID_JSON', 'signed webhook body is not valid JSON'))
    }
    return unexpected(error, request, event, options)
  }

  const envelope = parseEnvelope(verified)
  if (envelope === undefined) {
    return json(
      400,
      errorBody(
        'WEBHOOK_INVALID_ENVELOPE',
        'body must contain string type and timestamp fields plus data',
      ),
    )
  }
  if (envelope.type !== event) {
    return json(
      400,
      errorBody('WEBHOOK_EVENT_MISMATCH', `expected event '${event}', received '${envelope.type}'`),
    )
  }

  const webhookId = signatureContext.webhookId
  const attemptSeconds = Number(signatureContext.webhookTimestamp)
  if (webhookId === null || !Number.isFinite(attemptSeconds)) {
    return json(
      401,
      errorBody('WEBHOOK_INVALID_SIGNATURE', 'webhook signature verification failed'),
    )
  }
  const delivery: VerifiedWebhookDelivery<E> = {
    request,
    webhookId,
    attemptTimestamp: new Date(attemptSeconds * 1000),
    envelope: envelope as StandardWebhookEnvelope<E, unknown>,
  }

  let claimed = false
  try {
    if (options.idempotency !== undefined) {
      claimed = await options.idempotency.claim(webhookId)
      if (!claimed) {
        return json(200, {
          ok: true,
          status: 'duplicate',
          webhookId,
          event,
        })
      }
    }

    const run = await options.resolveRun(delivery)
    if (run === null || run === undefined) {
      await release(options, webhookId, claimed)
      return json(
        404,
        errorBody('WEBHOOK_RUN_NOT_FOUND', 'no OpenWizard run matched this delivery'),
      )
    }

    const correlationId =
      options.correlationId === undefined
        ? delivery.envelope.subject
        : await options.correlationId(delivery)
    const result = await run.send(
      event,
      delivery.envelope.data,
      correlationId === undefined ? undefined : { correlationId },
    )
    if (!result.ok) {
      await release(options, webhookId, claimed)
      return resultResponse(result)
    }
    return json(202, {
      ok: true,
      status: 'accepted',
      webhookId,
      event,
      delivered: result.delivered,
      buffered: result.buffered,
      seq: result.seq,
    })
  } catch (error) {
    await releaseQuietly(options, webhookId, claimed)
    return unexpected(error, request, event, options, webhookId)
  }
}

function resultResponse(result: Exclude<SendResult, { readonly ok: true }>): Response {
  if (result.reason === 'rejected') {
    return json(422, {
      ok: false,
      code: result.code,
      message: result.message,
      issues: result.issues,
    })
  }
  return json(409, errorBody(result.code, result.message))
}

function parseEnvelope(value: unknown): StandardWebhookEnvelope<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!('type' in value) || typeof value.type !== 'string' || value.type.length === 0)
    return undefined
  if (
    !('timestamp' in value) ||
    typeof value.timestamp !== 'string' ||
    value.timestamp.length === 0 ||
    Number.isNaN(Date.parse(value.timestamp))
  ) {
    return undefined
  }
  if (!('data' in value)) return undefined
  const subject = 'subject' in value ? value.subject : undefined
  if (subject !== undefined && typeof subject !== 'string') {
    return undefined
  }
  return {
    type: value.type,
    timestamp: value.timestamp,
    data: value.data,
    ...(typeof subject === 'string' ? { subject } : {}),
  }
}

function signatureContextOf(request: Request): WebhookSignatureContext {
  return {
    request,
    webhookId: request.headers.get('webhook-id'),
    webhookTimestamp: request.headers.get('webhook-timestamp'),
    webhookSignature: request.headers.get('webhook-signature'),
  }
}

function isJson(contentType: string | null): boolean {
  if (contentType === null) return false
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true
}

async function release<F extends AnyFlow, E extends EventType<F>>(
  options: WebhookResourceOptions<F, E>,
  webhookId: string,
  claimed: boolean,
): Promise<void> {
  if (claimed) await options.idempotency?.release(webhookId)
}

async function releaseQuietly<F extends AnyFlow, E extends EventType<F>>(
  options: WebhookResourceOptions<F, E>,
  webhookId: string,
  claimed: boolean,
): Promise<void> {
  try {
    await release(options, webhookId, claimed)
  } catch {
    // The original receiver error is more useful than a cleanup error.
  }
}

async function unexpected<F extends AnyFlow, E extends EventType<F>>(
  error: unknown,
  request: Request,
  event: E,
  options: WebhookResourceOptions<F, E>,
  webhookId?: string,
): Promise<Response> {
  const context: WebhookFailureContext = {
    request,
    event,
    ...(webhookId === undefined ? {} : { webhookId }),
  }
  try {
    await options.onError?.(error, context)
  } catch {
    // An observer must not replace the receiver's stable failure response.
  }
  return json(
    500,
    errorBody('WEBHOOK_INTERNAL_ERROR', 'webhook receiver failed before accepting the event'),
  )
}

function errorBody(code: string, message: string): Readonly<Record<string, unknown>> {
  return { ok: false, code, message }
}

function json(
  status: number,
  body: Readonly<Record<string, unknown>>,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`)
}

function requirePath(path: string): void {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new TypeError('webhook path must be an absolute pathname without a query or hash')
  }
}
