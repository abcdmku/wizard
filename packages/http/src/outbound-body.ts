import { isRecord } from './json-schema'
import type { WebhookDeliveryStatus, WebhookSubscriptionStatus } from './outbound-types'

/** A request the subscription API rejects with a 400 and `code`. */
export class SubscriptionInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** The body of `POST <base>`: an endpoint, declared events, an optional description. */
export function createBody(
  input: unknown,
  declared: readonly string[],
): {
  readonly endpoint: string
  readonly events: readonly string[]
  readonly description?: string
} {
  const record = exactRecord(input, ['description', 'endpoint', 'events'])
  const description = optionalDescription(record.description, false)
  return {
    endpoint: endpointOf(record.endpoint),
    events: eventList(record.events, declared),
    ...(typeof description === 'string' ? { description } : {}),
  }
}

/** The body of `PATCH <base>/:subscriptionId`: at least one field to change. */
export function updateBody(
  input: unknown,
  declared: readonly string[],
): {
  readonly endpoint?: string
  readonly events?: readonly string[]
  readonly status?: 'active' | 'paused'
  readonly description?: string | null
} {
  const record = exactRecord(input, ['description', 'endpoint', 'events', 'status'])
  if (Object.keys(record).length === 0)
    invalid('WEBHOOK_INVALID_BODY', 'update body must change a field')
  const { status } = record
  if (status !== undefined && status !== 'active' && status !== 'paused') {
    invalid('WEBHOOK_INVALID_BODY', "status must be 'active' or 'paused'")
  }
  const description = optionalDescription(record.description, true)
  return {
    ...(record.endpoint === undefined ? {} : { endpoint: endpointOf(record.endpoint) }),
    ...(record.events === undefined ? {} : { events: eventList(record.events, declared) }),
    ...(status === undefined ? {} : { status }),
    ...(description === undefined ? {} : { description }),
  }
}

export function subscriptionStatus(value: string | null): WebhookSubscriptionStatus | undefined {
  if (value === null) return undefined
  if (value === 'active' || value === 'disabled' || value === 'paused') return value
  return invalid('WEBHOOK_INVALID_QUERY', `unknown subscription status '${value}'`)
}

export function deliveryStatus(value: string | null): WebhookDeliveryStatus | undefined {
  if (value === null) return undefined
  if (value === 'delivering' || value === 'failed' || value === 'queued' || value === 'succeeded') {
    return value
  }
  return invalid('WEBHOOK_INVALID_QUERY', `unknown delivery status '${value}'`)
}

export function declaredEvent(
  value: string | null,
  declared: readonly string[],
): string | undefined {
  if (value === null) return undefined
  return declared.includes(value)
    ? value
    : invalid('WEBHOOK_EVENT_NOT_DECLARED', `unknown event '${value}'`)
}

export function pageLimit(value: string | null): number {
  if (value === null) return 50
  const limit = Number(value)
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100
    ? limit
    : invalid('WEBHOOK_INVALID_QUERY', 'limit must be an integer from 1 to 100')
}

function eventList(value: unknown, declared: readonly string[]): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((event) => typeof event === 'string')
  ) {
    return invalid('WEBHOOK_INVALID_BODY', 'events must be a non-empty array of event names')
  }
  if (new Set(value).size !== value.length)
    invalid('WEBHOOK_INVALID_BODY', 'events must not contain duplicates')
  const unknown = value.find((event) => !declared.includes(event))
  if (unknown !== undefined) invalid('WEBHOOK_EVENT_NOT_DECLARED', `unknown event '${unknown}'`)
  return value
}

function endpointOf(value: unknown): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : invalid('WEBHOOK_INVALID_BODY', 'endpoint must be a non-empty string')
}

function optionalDescription(value: unknown, allowNull: boolean): string | null | undefined {
  if (value === undefined) return undefined
  if (allowNull && value === null) return null
  return typeof value === 'string' && value.length <= 256
    ? value
    : invalid('WEBHOOK_INVALID_BODY', 'description must be a string no longer than 256 characters')
}

function exactRecord(
  input: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(input)) return invalid('WEBHOOK_INVALID_BODY', 'request body must be an object')
  const extra = Object.keys(input).find((key) => !allowed.includes(key))
  if (extra !== undefined) invalid('WEBHOOK_INVALID_BODY', `unknown field '${extra}'`)
  return input
}

function invalid(code: string, message: string): never {
  throw new SubscriptionInputError(code, message)
}
