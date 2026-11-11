import { authorizeRequest, type ScopeProvider } from './auth'
import type { AnyHTTPResource } from './http'
import { failure, json, readJson, requireNonEmpty } from './http-response'
import {
  createBody,
  declaredEvent,
  deliveryStatus,
  pageLimit,
  SubscriptionInputError,
  subscriptionStatus,
  updateBody,
} from './outbound-body'
import type { DeliveryContext } from './outbound-delivery'
import { subscriptionOperation } from './outbound-openapi'
import type {
  OutboundWebhookEvents,
  OutboundWebhookFailureContext,
  WebhookDelivery,
  WebhookDeliveryView,
  WebhookStore,
  WebhookSubscription,
  WebhookSubscriptionOperation,
  WebhookSubscriptionsOptions,
  WebhookSubscriptionView,
} from './outbound-types'
import { parametersOf } from './router'

/** Everything the management routes need, resolved once by `createWebhookSubscriptions`. */
export interface SubscriptionAPI<P> {
  readonly id: string
  readonly events: readonly string[]
  readonly store: WebhookStore
  readonly auth: Pick<ScopeProvider<P>, 'authenticate' | 'documentation'>
  readonly authorize: WebhookSubscriptionsOptions<OutboundWebhookEvents, P>['authorize']
  readonly basePath: string
  readonly scopes: { readonly read: readonly string[]; readonly write: readonly string[] }
  readonly maxBodyBytes: number
  readonly now: () => number
  readonly subscriptionId: () => string
  readonly secret: () => string
  readonly validateEndpoint: DeliveryContext['validateEndpoint']
  readonly onError: WebhookSubscriptionsOptions<OutboundWebhookEvents, unknown>['onError']
}

/** One management route: its SDK method name, operation, method and path below the base. */
export interface SubscriptionRoute {
  readonly name: string
  readonly operation: WebhookSubscriptionOperation
  readonly method: AnyHTTPResource['method']
  readonly suffix: string
}

const ROUTES: readonly SubscriptionRoute[] = [
  { name: 'listSubscriptions', operation: 'subscription:list', method: 'GET', suffix: '' },
  { name: 'createSubscription', operation: 'subscription:create', method: 'POST', suffix: '' },
  {
    name: 'getSubscription',
    operation: 'subscription:read',
    method: 'GET',
    suffix: '/:subscriptionId',
  },
  {
    name: 'updateSubscription',
    operation: 'subscription:update',
    method: 'PATCH',
    suffix: '/:subscriptionId',
  },
  {
    name: 'deleteSubscription',
    operation: 'subscription:delete',
    method: 'DELETE',
    suffix: '/:subscriptionId',
  },
  {
    name: 'rotateSecret',
    operation: 'subscription:rotate-secret',
    method: 'POST',
    suffix: '/:subscriptionId/secret',
  },
  {
    name: 'listDeliveries',
    operation: 'delivery:list',
    method: 'GET',
    suffix: '/:subscriptionId/deliveries',
  },
  {
    name: 'retryDelivery',
    operation: 'delivery:retry',
    method: 'POST',
    suffix: '/:subscriptionId/deliveries/:deliveryId/retry',
  },
]

export function isReadOperation(operation: WebhookSubscriptionOperation): boolean {
  return (
    operation === 'subscription:list' ||
    operation === 'subscription:read' ||
    operation === 'delivery:list'
  )
}

export function createSubscriptionResources<P>(
  api: SubscriptionAPI<P>,
): readonly AnyHTTPResource[] {
  return ROUTES.map((route) => {
    const resource: AnyHTTPResource = {
      id: `${api.id}:subscriptions:${route.name}`,
      method: route.method,
      path: `${api.basePath}${route.suffix}`,
      openAPI: subscriptionOperation(api, route),
      handle: (request) =>
        handle(api, route.operation, request, parametersOf(resource, request) ?? {}),
    }
    return resource
  })
}

type RouteParameters = { readonly subscriptionId?: string; readonly deliveryId?: string }

/** The route handlers' view of the API: no authentication left to do. */
type RouteContext = Omit<SubscriptionAPI<unknown>, 'auth' | 'authorize'>

async function handle<P>(
  api: SubscriptionAPI<P>,
  operation: WebhookSubscriptionOperation,
  request: Request,
  parameters: RouteParameters,
): Promise<Response> {
  const requiredScopes = isReadOperation(operation) ? api.scopes.read : api.scopes.write
  const { authorize } = api
  let tenantId: string | undefined
  try {
    const identity = await authorizeRequest(
      api.auth,
      request,
      requiredScopes,
      authorize === undefined
        ? undefined
        : (identity) => authorize({ request, identity, requiredScopes, operation, ...parameters }),
    )
    if (identity instanceof Response) return identity
    tenantId = identity.tenantId
    return await HANDLERS[operation](api, request, identity.tenantId, parameters)
  } catch (error) {
    if (error instanceof SubscriptionInputError) return failure(400, error.code, error.message)
    const context: OutboundWebhookFailureContext = {
      operation: 'api',
      request,
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(parameters.subscriptionId === undefined
        ? {}
        : { subscriptionId: parameters.subscriptionId }),
    }
    try {
      await api.onError?.(error, context)
    } catch {
      // An observer cannot replace the stable response.
    }
    return failure(500, 'INTERNAL_ERROR', 'the webhook subscription request failed')
  }
}

type Handler = (
  api: RouteContext,
  request: Request,
  tenantId: string,
  parameters: RouteParameters,
) => Promise<Response>

const HANDLERS: { readonly [K in WebhookSubscriptionOperation]: Handler } = {
  async 'subscription:list'(api, request, tenantId) {
    const query = new URL(request.url).searchParams
    const event = declaredEvent(query.get('event'), api.events)
    const status = subscriptionStatus(query.get('status'))
    const subscriptions = await api.store.listSubscriptions({
      tenantId,
      ...(event === undefined ? {} : { event }),
      ...(status === undefined ? {} : { status }),
    })
    return json(200, { ok: true, data: subscriptions.map(subscriptionView) })
  },
  async 'subscription:create'(api, request, tenantId) {
    const input = await readJson(request, api.maxBodyBytes)
    if (input instanceof Response) return input
    const body = createBody(input.value, api.events)
    const endpoint = await checkedEndpoint(api, body.endpoint, { phase: 'create', tenantId })
    const secret = requireNonEmpty(api.secret(), 'generated webhook secret')
    const now = api.now()
    const subscription: WebhookSubscription = {
      id: requireNonEmpty(api.subscriptionId(), 'generated subscription id'),
      tenantId,
      endpoint,
      events: body.events,
      status: 'active',
      secret,
      ...(body.description === undefined ? {} : { description: body.description }),
      createdAt: now,
      updatedAt: now,
    }
    await api.store.createSubscription(subscription)
    return json(201, { ok: true, data: { ...subscriptionView(subscription), secret } })
  },
  async 'subscription:read'(api, _request, tenantId, { subscriptionId = '' }) {
    return viewOrNotFound(await api.store.getSubscription(tenantId, subscriptionId))
  },
  async 'subscription:update'(api, request, tenantId, { subscriptionId = '' }) {
    if ((await api.store.getSubscription(tenantId, subscriptionId)) === undefined) return notFound()
    const input = await readJson(request, api.maxBodyBytes)
    if (input instanceof Response) return input
    const body = updateBody(input.value, api.events)
    const endpoint =
      body.endpoint === undefined
        ? undefined
        : await checkedEndpoint(api, body.endpoint, { phase: 'update', tenantId, subscriptionId })
    return viewOrNotFound(
      await api.store.updateSubscription(tenantId, subscriptionId, {
        ...(endpoint === undefined ? {} : { endpoint }),
        ...(body.events === undefined ? {} : { events: body.events }),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.status === 'active' ? { disabledReason: null } : {}),
        updatedAt: api.now(),
      }),
    )
  },
  async 'subscription:delete'(api, _request, tenantId, { subscriptionId = '' }) {
    if (!(await api.store.deleteSubscription(tenantId, subscriptionId))) return notFound()
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  },
  async 'subscription:rotate-secret'(api, _request, tenantId, { subscriptionId = '' }) {
    const secret = requireNonEmpty(api.secret(), 'generated webhook secret')
    const rotated = await api.store.rotateSubscriptionSecret(
      tenantId,
      subscriptionId,
      secret,
      api.now(),
    )
    return rotated === undefined
      ? notFound()
      : json(200, { ok: true, data: { ...subscriptionView(rotated), secret } })
  },
  async 'delivery:list'(api, request, tenantId, { subscriptionId = '' }) {
    if ((await api.store.getSubscription(tenantId, subscriptionId)) === undefined) return notFound()
    const query = new URL(request.url).searchParams
    const status = deliveryStatus(query.get('status'))
    const deliveries = await api.store.listDeliveries({
      tenantId,
      subscriptionId,
      ...(status === undefined ? {} : { status }),
      limit: pageLimit(query.get('limit')),
    })
    return json(200, { ok: true, data: deliveries.map(deliveryView) })
  },
  async 'delivery:retry'(api, _request, tenantId, { subscriptionId = '', deliveryId = '' }) {
    if ((await api.store.getSubscription(tenantId, subscriptionId)) === undefined) return notFound()
    const delivery = await api.store.retryDelivery(tenantId, subscriptionId, deliveryId, api.now())
    return delivery === undefined
      ? failure(
          409,
          'WEBHOOK_DELIVERY_NOT_RETRYABLE',
          'the delivery does not exist or has not failed',
        )
      : json(202, { ok: true, data: deliveryView(delivery) })
  },
}

async function checkedEndpoint(
  api: RouteContext,
  endpoint: string,
  context: Parameters<DeliveryContext['validateEndpoint']>[1],
): Promise<string> {
  try {
    return await api.validateEndpoint(endpoint, context)
  } catch (error) {
    if (error instanceof TypeError)
      throw new SubscriptionInputError('WEBHOOK_INVALID_ENDPOINT', error.message)
    throw error
  }
}

function viewOrNotFound(subscription: WebhookSubscription | undefined): Response {
  return subscription === undefined
    ? notFound()
    : json(200, { ok: true, data: subscriptionView(subscription) })
}

function notFound(): Response {
  return failure(404, 'NOT_FOUND', 'the subscription or delivery was not found')
}

function subscriptionView(subscription: WebhookSubscription): WebhookSubscriptionView {
  const { secret: _secret, ...view } = subscription
  return view
}

function deliveryView(delivery: WebhookDelivery): WebhookDeliveryView {
  const { body: _body, secret: _secret, ...view } = delivery
  return view
}
