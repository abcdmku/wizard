import type { ScopeIdentity } from './api-types'
import { type AnyHTTPResource, defineHTTPResources } from './http'
import type {
  OutboundWebhookFailureContext,
  OutboundWebhookMaybePromise,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookDeliveryView,
  WebhookStore,
  WebhookSubscription,
  WebhookSubscriptionAPIOptions,
  WebhookSubscriptionOperation,
  WebhookSubscriptionStatus,
  WebhookSubscriptionView,
} from './outbound-types'

const DEFAULT_MAX_BODY_BYTES = 65_536

export interface SubscriptionResourceDependencies<P> {
  readonly id: string
  readonly events: readonly string[]
  readonly store: WebhookStore
  readonly api: WebhookSubscriptionAPIOptions<P>
  readonly now: () => number
  readonly subscriptionId: () => string
  readonly secret: () => string
  readonly validateEndpoint: (
    endpoint: string,
    context: {
      readonly phase: 'create' | 'update'
      readonly tenantId: string
      readonly subscriptionId?: string
    },
  ) => Promise<string>
  readonly onError?: (
    error: unknown,
    context: OutboundWebhookFailureContext,
  ) => OutboundWebhookMaybePromise<void>
}

export function createSubscriptionResources<P>(
  dependencies: SubscriptionResourceDependencies<P>,
): readonly AnyHTTPResource[] {
  const basePath = normalizeBasePath(dependencies.api.path ?? '/api/webhook-subscriptions')
  const subscriptionPath = `${basePath}/:subscriptionId`
  const secretPath = `${subscriptionPath}/secret`
  const deliveriesPath = `${subscriptionPath}/deliveries`
  const retryPath = `${deliveriesPath}/:deliveryId/retry`
  const definitions: readonly {
    readonly id: string
    readonly method: AnyHTTPResource['method']
    readonly path: string
    readonly operation: WebhookSubscriptionOperation
  }[] = [
    { id: 'list', method: 'GET', path: basePath, operation: 'subscription:list' },
    { id: 'create', method: 'POST', path: basePath, operation: 'subscription:create' },
    { id: 'read', method: 'GET', path: subscriptionPath, operation: 'subscription:read' },
    { id: 'update', method: 'PATCH', path: subscriptionPath, operation: 'subscription:update' },
    { id: 'delete', method: 'DELETE', path: subscriptionPath, operation: 'subscription:delete' },
    {
      id: 'rotate-secret',
      method: 'POST',
      path: secretPath,
      operation: 'subscription:rotate-secret',
    },
    { id: 'deliveries', method: 'GET', path: deliveriesPath, operation: 'delivery:list' },
    { id: 'retry', method: 'POST', path: retryPath, operation: 'delivery:retry' },
  ]
  const readScopes = dependencies.api.scopes?.read ?? [`${dependencies.id}:webhooks:read`]
  const writeScopes = dependencies.api.scopes?.write ?? [`${dependencies.id}:webhooks:write`]
  const components = {
    securitySchemes: {
      [dependencies.api.auth.documentation.schemeName]: inheritOAuthScopes(
        dependencies.api.auth.documentation.securityScheme,
        scopeDescriptions(dependencies.id, [
          { scopes: readScopes, use: 'subscription and delivery reads' },
          { scopes: writeScopes, use: 'subscription writes and delivery retries' },
        ]),
      ),
    },
  }
  return defineHTTPResources(
    definitions.map((definition) => ({
      id: `${dependencies.id}:subscriptions:${definition.id}`,
      method: definition.method,
      path: definition.path,
      openAPIPath: toOpenAPIPath(definition.path),
      openAPI: createOperation(dependencies, definition.operation),
      openAPIComponents: components,
      handle: (request: Request) =>
        handleSubscriptionRequest(
          request,
          basePath,
          definition.method,
          definition.operation,
          dependencies,
        ),
    })),
  )
}

async function handleSubscriptionRequest<P>(
  request: Request,
  basePath: string,
  method: AnyHTTPResource['method'],
  operation: WebhookSubscriptionOperation,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (request.method.toUpperCase() !== method) return methodNotAllowed(method)
  const parameters = routeParameters(request, basePath)
  if (parameters === undefined || !operationMatchesRoute(operation, parameters.kind)) {
    return notFound()
  }
  const requiredScopes = scopesFor(operation, dependencies)
  let identity: ScopeIdentity<P>
  let tenantId: string | undefined
  try {
    const authenticated = await dependencies.api.auth.authenticate(request)
    if (!validIdentity(authenticated)) return unauthorized(dependencies)
    identity = authenticated
    tenantId = identity.tenantId
    const allowed =
      dependencies.api.authorize === undefined
        ? requiredScopes.every((scope) => identity.scopes.includes(scope))
        : await dependencies.api.authorize({
            request,
            identity,
            tenantId,
            requiredScopes,
            operation,
            ...(parameters.subscriptionId === undefined
              ? {}
              : { subscriptionId: parameters.subscriptionId }),
            ...(parameters.deliveryId === undefined ? {} : { deliveryId: parameters.deliveryId }),
          })
    if (!allowed) return forbidden(requiredScopes)
  } catch (error) {
    return unexpected(error, request, dependencies, tenantId, parameters.subscriptionId)
  }

  try {
    switch (operation) {
      case 'subscription:list':
        return await listSubscriptions(request, tenantId, dependencies)
      case 'subscription:create':
        return await createSubscription(request, tenantId, dependencies)
      case 'subscription:read':
        return await readSubscription(tenantId, parameters.subscriptionId, dependencies)
      case 'subscription:update':
        return await updateSubscription(request, tenantId, parameters.subscriptionId, dependencies)
      case 'subscription:delete':
        return await deleteSubscription(tenantId, parameters.subscriptionId, dependencies)
      case 'subscription:rotate-secret':
        return await rotateSecret(tenantId, parameters.subscriptionId, dependencies)
      case 'delivery:list':
        return await listDeliveries(request, tenantId, parameters.subscriptionId, dependencies)
      case 'delivery:retry':
        return await retryDelivery(
          tenantId,
          parameters.subscriptionId,
          parameters.deliveryId,
          dependencies,
        )
    }
  } catch (error) {
    if (error instanceof SubscriptionInputError) {
      return json(400, errorBody(error.code, error.message))
    }
    return unexpected(error, request, dependencies, tenantId, parameters.subscriptionId)
  }
}

async function listSubscriptions<P>(
  request: Request,
  tenantId: string,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  const url = new URL(request.url)
  const event = url.searchParams.get('event') ?? undefined
  const statusValue = url.searchParams.get('status') ?? undefined
  if (event !== undefined && !dependencies.events.includes(event)) {
    throw new SubscriptionInputError('WEBHOOK_EVENT_NOT_DECLARED', `unknown event '${event}'`)
  }
  const status = parseSubscriptionStatus(statusValue)
  const subscriptions = await dependencies.store.listSubscriptions({
    tenantId,
    ...(event === undefined ? {} : { event }),
    ...(status === undefined ? {} : { status }),
  })
  return json(200, { ok: true, data: subscriptions.map(subscriptionView) })
}

async function createSubscription<P>(
  request: Request,
  tenantId: string,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  const input = await readJSON(request, dependencies.api.maxBodyBytes)
  if (input instanceof Response) return input
  const body = createBody(input, dependencies.events)
  const endpoint = await validateEndpoint(dependencies, body.endpoint, {
    phase: 'create',
    tenantId,
  })
  const id = nonEmpty(dependencies.subscriptionId(), 'generated subscription id')
  const secret = nonEmpty(dependencies.secret(), 'generated webhook secret')
  const now = dependencies.now()
  const subscription: WebhookSubscription = {
    id,
    tenantId,
    endpoint,
    events: body.events,
    status: 'active',
    secret,
    ...(body.description === undefined ? {} : { description: body.description }),
    createdAt: now,
    updatedAt: now,
  }
  await dependencies.store.createSubscription(subscription)
  return json(201, { ok: true, data: subscriptionView(subscription), secret })
}

async function readSubscription<P>(
  tenantId: string,
  subscriptionId: string | undefined,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (subscriptionId === undefined) return notFound()
  const subscription = await dependencies.store.getSubscription(tenantId, subscriptionId)
  return subscription === undefined
    ? notFound()
    : json(200, { ok: true, data: subscriptionView(subscription) })
}

async function updateSubscription<P>(
  request: Request,
  tenantId: string,
  subscriptionId: string | undefined,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (subscriptionId === undefined) return notFound()
  if ((await dependencies.store.getSubscription(tenantId, subscriptionId)) === undefined) {
    return notFound()
  }
  const input = await readJSON(request, dependencies.api.maxBodyBytes)
  if (input instanceof Response) return input
  const body = updateBody(input, dependencies.events)
  const endpoint =
    body.endpoint === undefined
      ? undefined
      : await validateEndpoint(dependencies, body.endpoint, {
          phase: 'update',
          tenantId,
          subscriptionId,
        })
  const subscription = await dependencies.store.updateSubscription(tenantId, subscriptionId, {
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(body.events === undefined ? {} : { events: body.events }),
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.description === undefined ? {} : { description: body.description }),
    ...(body.status === 'active' ? { disabledReason: null } : {}),
    updatedAt: dependencies.now(),
  })
  return subscription === undefined
    ? notFound()
    : json(200, { ok: true, data: subscriptionView(subscription) })
}

async function deleteSubscription<P>(
  tenantId: string,
  subscriptionId: string | undefined,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (
    subscriptionId === undefined ||
    !(await dependencies.store.deleteSubscription(tenantId, subscriptionId))
  ) {
    return notFound()
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

async function rotateSecret<P>(
  tenantId: string,
  subscriptionId: string | undefined,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (subscriptionId === undefined) return notFound()
  const secret = nonEmpty(dependencies.secret(), 'generated webhook secret')
  const subscription = await dependencies.store.rotateSubscriptionSecret(
    tenantId,
    subscriptionId,
    secret,
    dependencies.now(),
  )
  return subscription === undefined
    ? notFound()
    : json(200, { ok: true, data: subscriptionView(subscription), secret })
}

async function listDeliveries<P>(
  request: Request,
  tenantId: string,
  subscriptionId: string | undefined,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (
    subscriptionId === undefined ||
    (await dependencies.store.getSubscription(tenantId, subscriptionId)) === undefined
  ) {
    return notFound()
  }
  const url = new URL(request.url)
  const status = parseDeliveryStatus(url.searchParams.get('status') ?? undefined)
  const limit = parseLimit(url.searchParams.get('limit'))
  const deliveries = await dependencies.store.listDeliveries({
    tenantId,
    subscriptionId,
    ...(status === undefined ? {} : { status }),
    limit,
  })
  return json(200, { ok: true, data: deliveries.map(deliveryView) })
}

async function retryDelivery<P>(
  tenantId: string,
  subscriptionId: string | undefined,
  deliveryId: string | undefined,
  dependencies: SubscriptionResourceDependencies<P>,
): Promise<Response> {
  if (subscriptionId === undefined || deliveryId === undefined) return notFound()
  if ((await dependencies.store.getSubscription(tenantId, subscriptionId)) === undefined) {
    return notFound()
  }
  const delivery = await dependencies.store.retryDelivery(
    tenantId,
    subscriptionId,
    deliveryId,
    dependencies.now(),
  )
  return delivery === undefined
    ? json(
        409,
        errorBody('WEBHOOK_DELIVERY_NOT_RETRYABLE', 'the delivery does not exist or is not failed'),
      )
    : json(202, { ok: true, data: deliveryView(delivery) })
}

async function validateEndpoint<P>(
  dependencies: SubscriptionResourceDependencies<P>,
  endpoint: string,
  context: {
    readonly phase: 'create' | 'update'
    readonly tenantId: string
    readonly subscriptionId?: string
  },
): Promise<string> {
  try {
    return await dependencies.validateEndpoint(endpoint, context)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new SubscriptionInputError('WEBHOOK_INVALID_ENDPOINT', error.message)
    }
    throw error
  }
}

function createBody(
  input: unknown,
  declaredEvents: readonly string[],
): {
  readonly endpoint: string
  readonly events: readonly string[]
  readonly description?: string
} {
  const record = requireRecord(input)
  exactKeys(record, ['description', 'endpoint', 'events'])
  if (typeof record.endpoint !== 'string' || record.endpoint.length === 0) {
    throw new SubscriptionInputError('WEBHOOK_INVALID_BODY', 'endpoint must be a non-empty string')
  }
  const events = eventList(record.events, declaredEvents)
  const description = optionalDescription(record.description)
  return {
    endpoint: record.endpoint,
    events,
    ...(typeof description === 'string' ? { description } : {}),
  }
}

function updateBody(
  input: unknown,
  declaredEvents: readonly string[],
): {
  readonly endpoint?: string
  readonly events?: readonly string[]
  readonly status?: 'active' | 'paused'
  readonly description?: string | null
} {
  const record = requireRecord(input)
  exactKeys(record, ['description', 'endpoint', 'events', 'status'])
  if (Object.keys(record).length === 0) {
    throw new SubscriptionInputError('WEBHOOK_INVALID_BODY', 'update body must change a field')
  }
  if (
    record.endpoint !== undefined &&
    (typeof record.endpoint !== 'string' || record.endpoint.length === 0)
  ) {
    throw new SubscriptionInputError('WEBHOOK_INVALID_BODY', 'endpoint must be a non-empty string')
  }
  let status: 'active' | 'paused' | undefined
  if (record.status !== undefined) {
    if (record.status !== 'active' && record.status !== 'paused') {
      throw new SubscriptionInputError(
        'WEBHOOK_INVALID_BODY',
        "status must be 'active' or 'paused'",
      )
    }
    status = record.status
  }
  const description = optionalDescription(record.description, true)
  return {
    ...(record.endpoint === undefined ? {} : { endpoint: record.endpoint }),
    ...(record.events === undefined ? {} : { events: eventList(record.events, declaredEvents) }),
    ...(status === undefined ? {} : { status }),
    ...(description === undefined ? {} : { description }),
  }
}

function eventList(value: unknown, declaredEvents: readonly string[]): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((event) => typeof event !== 'string' || event.length === 0)
  ) {
    throw new SubscriptionInputError(
      'WEBHOOK_INVALID_BODY',
      'events must be a non-empty array of event names',
    )
  }
  const events = value as string[]
  if (new Set(events).size !== events.length) {
    throw new SubscriptionInputError('WEBHOOK_INVALID_BODY', 'events must not contain duplicates')
  }
  const unknown = events.find((event) => !declaredEvents.includes(event))
  if (unknown !== undefined) {
    throw new SubscriptionInputError('WEBHOOK_EVENT_NOT_DECLARED', `unknown event '${unknown}'`)
  }
  return [...events]
}

function optionalDescription(value: unknown, allowNull = false): string | null | undefined {
  if (value === undefined) return undefined
  if (allowNull && value === null) return null
  if (typeof value !== 'string' || value.length > 256) {
    throw new SubscriptionInputError(
      'WEBHOOK_INVALID_BODY',
      'description must be a string no longer than 256 characters',
    )
  }
  return value
}

function requireRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SubscriptionInputError('WEBHOOK_INVALID_BODY', 'request body must be an object')
  }
  return input as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(record).find((key) => !allowed.includes(key))
  if (extra !== undefined) {
    throw new SubscriptionInputError('WEBHOOK_INVALID_BODY', `unknown field '${extra}'`)
  }
}

async function readJSON(
  request: Request,
  configuredMaxBodyBytes: number | undefined,
): Promise<unknown | Response> {
  if (!isJson(request.headers.get('content-type'))) {
    return json(
      415,
      errorBody('WEBHOOK_UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json'),
    )
  }
  const maxBodyBytes = configuredMaxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBodyBytes) return bodyTooLarge()
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return json(400, errorBody('WEBHOOK_BODY_UNREADABLE', 'request body could not be read'))
  }
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return bodyTooLarge()
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return json(400, errorBody('WEBHOOK_INVALID_JSON', 'request body is not valid JSON'))
  }
}

function bodyTooLarge(): Response {
  return json(413, errorBody('WEBHOOK_BODY_TOO_LARGE', 'request body exceeds its size limit'))
}

function parseSubscriptionStatus(value: string | undefined): WebhookSubscriptionStatus | undefined {
  if (value === undefined) return undefined
  if (value === 'active' || value === 'disabled' || value === 'paused') return value
  throw new SubscriptionInputError(
    'WEBHOOK_INVALID_QUERY',
    `unknown subscription status '${value}'`,
  )
}

function parseDeliveryStatus(value: string | undefined): WebhookDeliveryStatus | undefined {
  if (value === undefined) return undefined
  if (value === 'delivering' || value === 'failed' || value === 'queued' || value === 'succeeded') {
    return value
  }
  throw new SubscriptionInputError('WEBHOOK_INVALID_QUERY', `unknown delivery status '${value}'`)
}

function parseLimit(value: string | null): number {
  if (value === null) return 50
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SubscriptionInputError(
      'WEBHOOK_INVALID_QUERY',
      'limit must be an integer from 1 to 100',
    )
  }
  return limit
}

function subscriptionView(subscription: WebhookSubscription): WebhookSubscriptionView {
  const { secret: _secret, ...view } = subscription
  return view
}

function deliveryView(delivery: WebhookDelivery): WebhookDeliveryView {
  const { body: _body, secret: _secret, ...view } = delivery
  return view
}

function scopesFor<P>(
  operation: WebhookSubscriptionOperation,
  dependencies: SubscriptionResourceDependencies<P>,
): readonly string[] {
  const read = dependencies.api.scopes?.read ?? [`${dependencies.id}:webhooks:read`]
  const write = dependencies.api.scopes?.write ?? [`${dependencies.id}:webhooks:write`]
  const scopes =
    operation === 'subscription:list' ||
    operation === 'subscription:read' ||
    operation === 'delivery:list'
      ? read
      : write
  if (scopes.some((scope) => typeof scope !== 'string' || scope.length === 0)) {
    throw new TypeError('subscription API scopes must be non-empty strings')
  }
  return scopes
}

function validIdentity<P>(identity: ScopeIdentity<P> | null): identity is ScopeIdentity<P> {
  return (
    identity !== null &&
    typeof identity === 'object' &&
    typeof identity.tenantId === 'string' &&
    identity.tenantId.length > 0 &&
    Object.hasOwn(identity, 'principal') &&
    Array.isArray(identity.scopes) &&
    identity.scopes.every((scope) => typeof scope === 'string' && scope.length > 0)
  )
}

function unauthorized<P>(dependencies: SubscriptionResourceDependencies<P>): Response {
  return json(401, errorBody('WEBHOOK_UNAUTHENTICATED', 'authentication failed'), {
    'www-authenticate': dependencies.api.auth.documentation.challenge ?? 'Bearer',
  })
}

function forbidden(requiredScopes: readonly string[]): Response {
  return json(403, {
    ...errorBody('WEBHOOK_INSUFFICIENT_SCOPE', 'the caller lacks a required scope'),
    requiredScopes,
  })
}

function notFound(): Response {
  return json(
    404,
    errorBody('WEBHOOK_SUBSCRIPTION_NOT_FOUND', 'the requested resource was not found'),
  )
}

function methodNotAllowed(method: AnyHTTPResource['method']): Response {
  return json(405, errorBody('WEBHOOK_METHOD_NOT_ALLOWED', `this resource requires ${method}`), {
    allow: method,
  })
}

async function unexpected<P>(
  error: unknown,
  request: Request,
  dependencies: SubscriptionResourceDependencies<P>,
  tenantId?: string,
  subscriptionId?: string,
): Promise<Response> {
  try {
    await dependencies.onError?.(error, {
      operation: 'api',
      request,
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(subscriptionId === undefined ? {} : { subscriptionId }),
    })
  } catch {
    // An observer cannot replace the stable API response.
  }
  return json(500, errorBody('WEBHOOK_INTERNAL_ERROR', 'the webhook subscription request failed'))
}

function createOperation<P>(
  dependencies: SubscriptionResourceDependencies<P>,
  operation: WebhookSubscriptionOperation,
): Readonly<Record<string, unknown>> {
  const write = !(
    operation === 'subscription:list' ||
    operation === 'subscription:read' ||
    operation === 'delivery:list'
  )
  const requiredScopes = write
    ? (dependencies.api.scopes?.write ?? [`${dependencies.id}:webhooks:write`])
    : (dependencies.api.scopes?.read ?? [`${dependencies.id}:webhooks:read`])
  const scheme = dependencies.api.auth.documentation.securityScheme.type
  const securityScopes = scheme === 'oauth2' || scheme === 'openIdConnect' ? requiredScopes : []
  const eventSchema = { type: 'string', enum: dependencies.events }
  const subscriptionParameter = {
    in: 'path',
    name: 'subscriptionId',
    required: true,
    schema: { type: 'string', minLength: 1 },
  }
  const deliveryParameter = {
    in: 'path',
    name: 'deliveryId',
    required: true,
    schema: { type: 'string', minLength: 1 },
  }
  const requestBody =
    operation === 'subscription:create'
      ? jsonRequest({
          type: 'object',
          additionalProperties: false,
          required: ['endpoint', 'events'],
          properties: {
            endpoint: { type: 'string', format: 'uri' },
            events: { type: 'array', minItems: 1, uniqueItems: true, items: eventSchema },
            description: { type: 'string', maxLength: 256 },
          },
        })
      : operation === 'subscription:update'
        ? jsonRequest({
            type: 'object',
            additionalProperties: false,
            minProperties: 1,
            properties: {
              endpoint: { type: 'string', format: 'uri' },
              events: { type: 'array', minItems: 1, uniqueItems: true, items: eventSchema },
              status: { type: 'string', enum: ['active', 'paused'] },
              description: { type: ['string', 'null'], maxLength: 256 },
            },
          })
        : undefined
  const docs = dependencies.api.docs
  const summaries: Record<WebhookSubscriptionOperation, string> = {
    'subscription:list': docs?.listSummary ?? 'List webhook subscriptions',
    'subscription:create': docs?.createSummary ?? 'Create a webhook subscription',
    'subscription:read': docs?.readSummary ?? 'Get a webhook subscription',
    'subscription:update': docs?.updateSummary ?? 'Update a webhook subscription',
    'subscription:delete': docs?.deleteSummary ?? 'Delete a webhook subscription',
    'subscription:rotate-secret': docs?.rotateSecretSummary ?? 'Rotate a webhook signing secret',
    'delivery:list': docs?.deliveriesSummary ?? 'List webhook deliveries',
    'delivery:retry': docs?.retryDeliverySummary ?? 'Retry a failed webhook delivery',
  }
  const parameters = [
    ...(operation === 'subscription:list' || operation === 'subscription:create'
      ? []
      : [subscriptionParameter]),
    ...(operation === 'delivery:retry' ? [deliveryParameter] : []),
  ]
  return {
    tags: docs?.tags ?? ['Webhook subscriptions'],
    summary: summaries[operation],
    operationId: `${operationName(dependencies.id)}${operationName(operation)}`,
    parameters,
    ...(requestBody === undefined ? {} : { requestBody }),
    security: [{ [dependencies.api.auth.documentation.schemeName]: securityScopes }],
    'x-required-scopes': requiredScopes,
    responses: operationResponses(operation),
  }
}

function scopeDescriptions(
  id: string,
  uses: readonly { readonly scopes: readonly string[]; readonly use: string }[],
): Readonly<Record<string, string>> {
  const byScope = new Map<string, string[]>()
  for (const entry of uses) {
    for (const scope of entry.scopes) {
      const current = byScope.get(scope) ?? []
      if (!current.includes(entry.use)) current.push(entry.use)
      byScope.set(scope, current)
    }
  }
  return Object.fromEntries(
    [...byScope].map(([scope, entries]) => [
      scope,
      `Required for ${entries.join(' and ')} in the '${id}' webhook API.`,
    ]),
  )
}

function inheritOAuthScopes(
  securityScheme: Readonly<Record<string, unknown>>,
  inherited: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  if (securityScheme.type !== 'oauth2' || !isRecord(securityScheme.flows)) return securityScheme

  const flows = Object.fromEntries(
    Object.entries(securityScheme.flows).map(([name, value]) => {
      if (!isRecord(value)) return [name, value]
      const declared = isRecord(value.scopes) ? value.scopes : {}
      return [name, { ...value, scopes: { ...inherited, ...declared } }]
    }),
  )
  return { ...securityScheme, flows }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationResponses(
  operation: WebhookSubscriptionOperation,
): Readonly<Record<string, unknown>> {
  const success =
    operation === 'subscription:create'
      ? 201
      : operation === 'subscription:delete'
        ? 204
        : operation === 'delivery:retry'
          ? 202
          : 200
  return {
    [success]: { description: 'The operation completed.' },
    400: { description: 'The request body, query, event, or endpoint is invalid.' },
    401: { description: 'Authentication failed.' },
    403: { description: 'The caller lacks a required scope.' },
    404: { description: 'The subscription or delivery was not found.' },
    409: { description: 'The delivery cannot be retried in its current state.' },
    413: { description: 'The request body exceeds its configured size limit.' },
    415: { description: 'The request does not use a JSON media type.' },
    500: { description: 'The subscription API failed.' },
  }
}

function jsonRequest(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { required: true, content: { 'application/json': { schema } } }
}

function operationName(value: string): string {
  return (
    value
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join('') || 'Webhooks'
  )
}

function routeParameters(
  request: Request,
  basePath: string,
):
  | {
      readonly kind: 'collection' | 'deliveries' | 'retry' | 'secret' | 'subscription'
      readonly subscriptionId?: string
      readonly deliveryId?: string
    }
  | undefined {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return undefined
  }
  const base = basePath.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (!base.every((segment, index) => actual[index] === segment)) return undefined
  const tail = actual.slice(base.length)
  if (tail.length === 0) return { kind: 'collection' }
  const subscriptionId = decodeSegment(tail[0])
  if (subscriptionId === undefined || subscriptionId.length === 0) return undefined
  if (tail.length === 1) return { kind: 'subscription', subscriptionId }
  if (tail.length === 2 && tail[1] === 'secret') return { kind: 'secret', subscriptionId }
  if (tail.length === 2 && tail[1] === 'deliveries') {
    return { kind: 'deliveries', subscriptionId }
  }
  if (tail.length === 4 && tail[1] === 'deliveries' && tail[3] === 'retry') {
    const deliveryId = decodeSegment(tail[2])
    return deliveryId === undefined || deliveryId.length === 0
      ? undefined
      : { kind: 'retry', subscriptionId, deliveryId }
  }
  return undefined
}

function operationMatchesRoute(
  operation: WebhookSubscriptionOperation,
  kind: 'collection' | 'deliveries' | 'retry' | 'secret' | 'subscription',
): boolean {
  switch (operation) {
    case 'subscription:create':
    case 'subscription:list':
      return kind === 'collection'
    case 'subscription:delete':
    case 'subscription:read':
    case 'subscription:update':
      return kind === 'subscription'
    case 'subscription:rotate-secret':
      return kind === 'secret'
    case 'delivery:list':
      return kind === 'deliveries'
    case 'delivery:retry':
      return kind === 'retry'
  }
}

function decodeSegment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function normalizeBasePath(path: string): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes(':')) {
    throw new TypeError(
      'subscription API path must be an absolute pathname without parameters, query, or hash',
    )
  }
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (normalized === '/') throw new TypeError('subscription API path must contain a segment')
  return normalized
}

function toOpenAPIPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${label} must not be empty`)
  return value
}

function isJson(contentType: string | null): boolean {
  if (contentType === null) return false
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true
}

function json(status: number, body: object, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function errorBody(code: string, message: string): Readonly<Record<string, unknown>> {
  return { ok: false, code, message }
}

class SubscriptionInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
