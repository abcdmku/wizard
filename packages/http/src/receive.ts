import type { AnyWizard, EventType } from '@openwizard/core'
import { type SharedOptions, unexpected } from './api-context'
import type { AnyHTTPResource } from './http'
import { failure, readText, requirePositiveInteger } from './http-response'
import { idempotent } from './idempotency'
import { isRecord } from './json-schema'
import { normalizePrefix } from './naming'
import type { FlowDocs } from './openapi-flow'
import { receiverOperation } from './receive-openapi'
import type {
  ReceiverOptions,
  StandardWebhookEnvelope,
  VerifiedWebhookDelivery,
  WebhookSecret,
  WebhookSignatureContext,
} from './receive-types'
import { hostIds, sendThrough } from './run-handle'
import { sendResponse } from './run-responses'
import { secretBytes, verifySignature } from './signature'

/** Settings of one receiver set, checked once by `createReceivers`. */
interface Receiver<F extends AnyWizard> {
  readonly id: string
  readonly options: ReceiverOptions<F>
  readonly shared: SharedOptions
  readonly toleranceSeconds: number
  readonly maxBodyBytes: number
}

/** One signed `POST <path>/<event>` route per listed event of `options.events`. */
export function createReceivers<F extends AnyWizard>(
  docs: FlowDocs<F>,
  id: string,
  options: ReceiverOptions<F>,
  shared: SharedOptions,
): readonly AnyHTTPResource[] {
  const events = receiverEvents(Object.keys(docs.schemas.events), options.events)
  validateSecret(options.secret)
  if (typeof options.resolve !== 'function')
    throw new TypeError('receive.resolve must be a function')
  requirePositiveInteger(options.toleranceSeconds, 'receive.toleranceSeconds')
  requirePositiveInteger(options.maxBodyBytes, 'receive.maxBodyBytes')
  const prefix = normalizePrefix(options.path ?? `/webhooks/${id}`, 'receive.path')
  const receiver: Receiver<F> = {
    id,
    options,
    shared,
    toleranceSeconds: options.toleranceSeconds ?? 300,
    maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
  }
  return events.map((event) => ({
    id: `${id}:receive:${event}`,
    method: 'POST',
    path: `${prefix}/${event}`,
    openAPI: receiverOperation(docs, id, event),
    handle: (request: Request) => receive(receiver, request, event),
  }))
}

async function receive<F extends AnyWizard>(
  receiver: Receiver<F>,
  request: Request,
  event: EventType<F>,
): Promise<Response> {
  const body = await readText(request, receiver.maxBodyBytes)
  if (body instanceof Response) return body
  try {
    const delivery = await verify(receiver, request, event, body)
    return delivery instanceof Response ? delivery : await deliver(receiver, delivery, event, body)
  } catch (error) {
    const webhookId = request.headers.get('webhook-id')
    return unexpected(receiver.shared.onError, error, {
      request,
      operation: 'receive',
      event,
      ...(webhookId === null ? {} : { webhookId }),
    })
  }
}

/** The signed, well-formed delivery of `event` in `body`, or the 401/400 answer. */
async function verify<F extends AnyWizard>(
  receiver: Receiver<F>,
  request: Request,
  event: EventType<F>,
  body: string,
): Promise<VerifiedWebhookDelivery<EventType<F>> | Response> {
  const secrets = await secretsOf(receiver.options.secret, {
    request,
    event,
    webhookId: request.headers.get('webhook-id'),
    webhookTimestamp: request.headers.get('webhook-timestamp'),
    webhookSignature: request.headers.get('webhook-signature'),
  })
  const verified = await verifySignature(
    request.headers,
    body,
    secrets,
    receiver.toleranceSeconds,
    Date.now(),
  )
  if (!verified.ok) {
    return failure(
      401,
      'WEBHOOK_INVALID_SIGNATURE',
      'the webhook signature is missing, stale or invalid',
    )
  }
  const envelope = parseEnvelope(body)
  if (envelope === undefined) {
    return failure(
      400,
      'WEBHOOK_INVALID_ENVELOPE',
      'the body must be JSON with string type and timestamp fields plus data',
    )
  }
  if (envelope.type !== event) {
    return failure(
      400,
      'WEBHOOK_EVENT_MISMATCH',
      `expected event '${event}', received '${envelope.type}'`,
    )
  }
  return {
    request,
    webhookId: verified.id,
    attemptTimestamp: verified.timestamp,
    envelope: { ...envelope, type: event },
  }
}

/** Send a verified delivery to the run `resolve` finds, once per `webhook-id`. */
async function deliver<F extends AnyWizard>(
  receiver: Receiver<F>,
  delivery: VerifiedWebhookDelivery<EventType<F>>,
  event: EventType<F>,
  body: string,
): Promise<Response> {
  const { options } = receiver
  const key = `${receiver.id}\0receive\0${delivery.webhookId}`
  const ids = await hostIds(key)
  const correlationId =
    options.correlationId === undefined
      ? delivery.envelope.subject
      : await options.correlationId(delivery)
  const handle = await options.resolve(delivery)
  if (handle === null || handle === undefined) {
    return failure(404, 'NOT_FOUND', 'no run matched this delivery')
  }
  return idempotent(receiver.shared.idempotency, key, body, async () =>
    sendResponse(await sendThrough(handle, event, delivery.envelope.data, { ids, correlationId })),
  )
}

async function secretsOf(
  secret: WebhookSecret,
  context: WebhookSignatureContext,
): Promise<readonly string[]> {
  const selected = typeof secret === 'function' ? await secret(context) : secret
  const secrets = typeof selected === 'string' ? [selected] : selected
  if (secrets.length === 0) throw new TypeError('the webhook secret selector returned no secret')
  return secrets
}

function validateSecret(secret: WebhookSecret): void {
  if (typeof secret === 'function') return
  const secrets = typeof secret === 'string' ? [secret] : secret
  if (!Array.isArray(secrets) || secrets.length === 0) {
    throw new TypeError('receive.secret must be a secret, a non-empty list, or a selector')
  }
  for (const value of secrets) secretBytes(value)
}

function receiverEvents<E extends string>(
  declared: readonly string[],
  selected: readonly E[],
): readonly E[] {
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new TypeError('receive.events must list the events senders may deliver')
  }
  const seen = new Set<string>()
  for (const event of selected) {
    if (!declared.includes(event))
      throw new TypeError(`receive.events contains unknown event '${event}'`)
    if (seen.has(event)) throw new TypeError(`receive.events contains duplicate event '${event}'`)
    seen.add(event)
  }
  return selected
}

function parseEnvelope(body: string): StandardWebhookEnvelope | undefined {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isRecord(value) || !Object.hasOwn(value, 'data')) return undefined
  const { type, timestamp, subject, data } = value
  if (typeof type !== 'string' || type.length === 0) return undefined
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) return undefined
  if (subject !== undefined && typeof subject !== 'string') return undefined
  return { type, timestamp, data, ...(subject === undefined ? {} : { subject }) }
}
