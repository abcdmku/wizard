import { toJSONSchema } from '@openwizard/core/inspect'
import { apiOperation } from './api-openapi'
import { type ScopeProvider, securityScheme } from './auth'
import { createSchemaRegistry, refTo } from './json-schema'
import { camelCase, pascalCase } from './naming'
import {
  envelope,
  errorResponses,
  headerParameter,
  jsonBody,
  jsonResponse,
  pathParameter,
} from './openapi-common'
import type { JSONSchema, OpenAPIContribution, OpenAPIOperation } from './openapi-types'
import { isReadOperation, type SubscriptionAPI, type SubscriptionRoute } from './outbound-routes'
import type { OutboundWebhookEvents } from './outbound-types'

const ERRORS = {
  401: 'Authentication failed.',
  403: 'The caller lacks a required scope.',
  500: 'The subscription API failed.',
}
const BODY_ERRORS = {
  400: 'The body, an event name or the endpoint is invalid.',
  413: 'The body exceeds the size limit.',
  415: 'The body is not JSON.',
}

/** What the documentation reads of a subscription API. */
type DocumentedAPI = Pick<SubscriptionAPI<unknown>, 'id' | 'events' | 'scopes'> & {
  readonly auth: Pick<ScopeProvider<unknown>, 'documentation'>
}

/** Component names of one subscription API, prefixed with its id. */
function names(id: string) {
  const prefix = pascalCase(id, 'Webhooks')
  return {
    subscription: `${prefix}Subscription`,
    withSecret: `${prefix}SubscriptionWithSecret`,
    input: `${prefix}SubscriptionInput`,
    patch: `${prefix}SubscriptionPatch`,
    delivery: `${prefix}Delivery`,
    event: (event: string) => `${prefix}${pascalCase(event, 'Event')}Webhook`,
    data: (event: string) => `${prefix}${pascalCase(event, 'Event')}Data`,
  }
}

/** The documented operation of one management route, grouped as `<id>.subscriptions`. */
export function subscriptionOperation(
  api: DocumentedAPI,
  route: SubscriptionRoute,
): OpenAPIOperation {
  const n = names(api.id)
  const read = isReadOperation(route.operation)
  const subscription = route.suffix.includes(':subscriptionId')
  const parameters: JSONSchema[] = [
    ...(subscription ? [pathParameter('subscriptionId', 'Subscription id.')] : []),
    ...(route.operation === 'delivery:retry' ? [pathParameter('deliveryId', 'Delivery id.')] : []),
    ...(route.operation === 'subscription:list'
      ? [
          query('event', { type: 'string', enum: api.events }),
          query('status', { type: 'string', enum: ['active', 'disabled', 'paused'] }),
        ]
      : []),
    ...(route.operation === 'delivery:list'
      ? [
          query('status', {
            type: 'string',
            enum: ['delivering', 'failed', 'queued', 'succeeded'],
          }),
          query('limit', { type: 'integer', minimum: 1, maximum: 100 }),
        ]
      : []),
  ]
  const body =
    route.operation === 'subscription:create'
      ? n.input
      : route.operation === 'subscription:update'
        ? n.patch
        : undefined
  const [status, description, schema] = success(route, n)
  return apiOperation(
    { id: api.id, provider: api.auth },
    route.name,
    read ? api.scopes.read : api.scopes.write,
    {
      summary: SUMMARIES[route.operation],
      description: `${SUMMARIES[route.operation]} of the authenticated tenant.`,
      ...(parameters.length === 0 ? {} : { parameters }),
      ...(body === undefined ? {} : { requestBody: jsonBody(body) }),
      responses: {
        [status]: schema === undefined ? { description } : jsonResponse(description, schema),
        ...errorResponses({
          ...ERRORS,
          ...(body === undefined ? { 400: 'A query parameter is invalid.' } : BODY_ERRORS),
          ...(subscription ? { 404: 'No such subscription or delivery for this tenant.' } : {}),
          ...(route.operation === 'delivery:retry' ? { 409: 'The delivery has not failed.' } : {}),
        }),
      },
    },
    'subscriptions',
  )
}

/** Named schemas, the security scheme, the tag and one OpenAPI `webhooks` entry per public event. */
export function subscriptionComponents(
  api: DocumentedAPI,
  events: OutboundWebhookEvents,
): OpenAPIContribution {
  const n = names(api.id)
  const registry = createSchemaRegistry()
  const eventNames = { type: 'string', enum: api.events }
  const required = ['id', 'tenantId', 'endpoint', 'events', 'status', 'createdAt', 'updatedAt']
  const properties = {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    endpoint: { type: 'string', format: 'uri' },
    events: { type: 'array', items: eventNames },
    status: { type: 'string', enum: ['active', 'disabled', 'paused'] },
    description: { type: 'string' },
    createdAt: { type: 'integer', description: 'Unix milliseconds.' },
    updatedAt: { type: 'integer', description: 'Unix milliseconds.' },
    disabledReason: { type: 'string' },
  }
  registry.ref(n.subscription, {
    type: 'object',
    description: 'A callback subscription (its secret is shown only on create and rotate).',
    required,
    properties,
  })
  registry.ref(n.withSecret, {
    type: 'object',
    description:
      'A subscription with its `whsec_` signing secret. Store the secret now; it is not shown again.',
    required: [...required, 'secret'],
    properties: { ...properties, secret: { type: 'string' } },
  })
  registry.ref(n.input, {
    type: 'object',
    additionalProperties: false,
    required: ['endpoint', 'events'],
    properties: {
      endpoint: { type: 'string', format: 'uri' },
      events: { type: 'array', minItems: 1, uniqueItems: true, items: eventNames },
      description: { type: 'string', maxLength: 256 },
    },
  })
  registry.ref(n.patch, {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      endpoint: { type: 'string', format: 'uri' },
      events: { type: 'array', minItems: 1, uniqueItems: true, items: eventNames },
      status: { type: 'string', enum: ['active', 'paused'] },
      description: { type: ['string', 'null'], maxLength: 256 },
    },
  })
  registry.ref(n.delivery, {
    type: 'object',
    description: 'One delivery of one event to one subscription, and its attempts.',
    required: [
      'id',
      'messageId',
      'tenantId',
      'subscriptionId',
      'eventType',
      'endpoint',
      'status',
      'attemptCount',
      'nextAttemptAt',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      messageId: { type: 'string', description: 'The webhook-id header of every attempt.' },
      tenantId: { type: 'string' },
      subscriptionId: { type: 'string' },
      eventType: eventNames,
      endpoint: { type: 'string', format: 'uri' },
      status: { type: 'string', enum: ['delivering', 'failed', 'queued', 'succeeded'] },
      attemptCount: { type: 'integer', minimum: 0 },
      nextAttemptAt: { type: 'integer' },
      createdAt: { type: 'integer' },
      updatedAt: { type: 'integer' },
      lastAttemptAt: { type: 'integer' },
      completedAt: { type: 'integer' },
      responseStatus: { type: 'integer' },
      error: { type: 'string' },
      leaseId: { type: 'string' },
      leaseExpiresAt: { type: 'integer' },
    },
  })
  for (const [name, schema] of [
    [n.subscription, refTo(n.subscription)],
    [`${n.subscription}List`, { type: 'array', items: refTo(n.subscription) }],
    [n.withSecret, refTo(n.withSecret)],
    [n.delivery, refTo(n.delivery)],
    [`${n.delivery}List`, { type: 'array', items: refTo(n.delivery) }],
  ] as const) {
    registry.ref(`${name}Response`, envelope('The request succeeded.', schema))
  }
  const webhooks = Object.fromEntries(
    Object.entries(events).map(([event, schema]) => {
      registry.ref(n.event(event), {
        type: 'object',
        description: `The signed body of a ${event} delivery.`,
        required: ['type', 'timestamp', 'data'],
        properties: {
          type: { type: 'string', enum: [event] },
          timestamp: { type: 'string', format: 'date-time' },
          subject: { type: 'string' },
          data: registry.ref(n.data(event), toJSONSchema(schema, 'output') ?? {}),
        },
      })
      return [`${api.id}.${event}`, { post: eventCallback(api.id, event, n.event(event)) }] as const
    }),
  )
  const scopes = Object.fromEntries([
    ...api.scopes.read.map((scope) => [
      scope,
      `Read ${api.id} webhook subscriptions and deliveries.`,
    ]),
    ...api.scopes.write.map((scope) => [
      scope,
      `Manage ${api.id} webhook subscriptions and retry deliveries.`,
    ]),
  ])
  return {
    schemas: registry.schemas,
    securitySchemes: { [api.auth.documentation.schemeName]: securityScheme(api.auth, scopes) },
    webhooks,
    tags: [
      {
        name: `${api.id}.subscriptions`,
        description: `Callback subscriptions for ${api.id} events.`,
      },
    ],
  }
}

/** The callback a subscriber's endpoint receives for `event`. */
function eventCallback(id: string, event: string, body: string): OpenAPIOperation {
  return {
    operationId: `${camelCase(id, 'webhooks')}${pascalCase(event, 'Event')}Webhook`,
    tags: [`${id}.subscriptions`],
    summary: `${event} delivery`,
    description: `Sent to every active subscription of the tenant that lists ${event}, signed with the subscription secret (Standard Webhooks). The webhook-id is stable across retries.`,
    parameters: [
      headerParameter('webhook-id', 'Message id, the same on every retry.', true),
      headerParameter('webhook-timestamp', 'Attempt time in Unix seconds.', true),
      headerParameter('webhook-signature', 'Space-separated `v1,<base64>` signatures.', true),
    ],
    requestBody: jsonBody(body),
    responses: {
      200: {
        description:
          'Any 2xx acknowledges the delivery. 410 disables the subscription; 408, 409, 425, 429 and 5xx are retried.',
      },
    },
    'x-fern-sdk-group-name': `${camelCase(id, 'webhooks')}.subscriptions`,
    'x-fern-sdk-method-name': `on${pascalCase(event, 'Event')}`,
    'x-standard-webhooks': '1.0.0',
  }
}

const SUMMARIES: { readonly [K in SubscriptionRoute['operation']]: string } = {
  'subscription:list': 'List webhook subscriptions',
  'subscription:create': 'Create a webhook subscription',
  'subscription:read': 'Get a webhook subscription',
  'subscription:update': 'Update a webhook subscription',
  'subscription:delete': 'Delete a webhook subscription',
  'subscription:rotate-secret': 'Rotate the signing secret of a webhook subscription',
  'delivery:list': 'List the deliveries of a webhook subscription',
  'delivery:retry': 'Retry a failed webhook delivery',
}

function success(
  route: SubscriptionRoute,
  n: ReturnType<typeof names>,
): readonly [number, string, string | undefined] {
  switch (route.operation) {
    case 'subscription:list':
      return [200, 'The subscriptions.', `${n.subscription}ListResponse`]
    case 'subscription:create':
      return [201, 'The subscription and its secret.', `${n.withSecret}Response`]
    case 'subscription:rotate-secret':
      return [200, 'The subscription and its new secret.', `${n.withSecret}Response`]
    case 'subscription:delete':
      return [204, 'The subscription was deleted.', undefined]
    case 'delivery:list':
      return [200, 'The newest deliveries first.', `${n.delivery}ListResponse`]
    case 'delivery:retry':
      return [202, 'The delivery is queued again.', `${n.delivery}Response`]
    default:
      return [200, 'The subscription.', `${n.subscription}Response`]
  }
}

function query(name: string, schema: JSONSchema): JSONSchema {
  return { in: 'query', name, required: false, schema }
}
