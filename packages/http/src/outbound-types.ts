import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { APIMaybePromise, ScopeIdentity, ScopeProvider } from './auth'
import type { HTTPSource } from './http'

/**
 * The public events subscribers may receive, by name, with the Standard Schema of their data.
 * This map is the allowlist: nothing else is ever published.
 * @public
 */
export type OutboundWebhookEvents = Readonly<Record<string, StandardSchemaV1>>

/** Input accepted by one declared outbound event schema. @public */
export type OutboundWebhookEventInput<S> = S extends StandardSchemaV1<infer I, unknown> ? I : never

/** Parsed data stored and delivered for one declared outbound event schema. @public */
export type OutboundWebhookEventData<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never

/** One typed public event passed to `WebhookSubscriptions.publish`. @public */
export type OutboundWebhookEvent<E extends OutboundWebhookEvents> = {
  readonly [K in keyof E & string]: {
    /** Stable public event name. Version it when its meaning or data contract changes. */
    readonly type: K
    readonly data: OutboundWebhookEventInput<E[K]>
    readonly tenantId: string
    /** Stable producer id, the `webhook-id` of every delivery. Reuse it to publish the same event again. */
    readonly eventId?: string
    readonly subject?: string
    /** Event creation time. Defaults to the publisher clock. */
    readonly timestamp?: Date | string
  }
}[keyof E & string]

/** Lifecycle state of a callback subscription. @public */
export type WebhookSubscriptionStatus = 'active' | 'disabled' | 'paused'

/** Stored callback subscription. Stores should encrypt `secret` at rest. @public */
export interface WebhookSubscription {
  readonly id: string
  readonly tenantId: string
  readonly endpoint: string
  readonly events: readonly string[]
  readonly status: WebhookSubscriptionStatus
  readonly secret: string
  readonly description?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly disabledReason?: string
}

/** Subscription data safe to return through the management API. @public */
export type WebhookSubscriptionView = Omit<WebhookSubscription, 'secret'>

/** Mutable fields accepted by a subscription store. @public */
export interface WebhookSubscriptionPatch {
  readonly endpoint?: string
  readonly events?: readonly string[]
  readonly status?: WebhookSubscriptionStatus
  readonly description?: string | null
  readonly disabledReason?: string | null
  readonly updatedAt: number
}

/** Lifecycle state of one queued delivery. @public */
export type WebhookDeliveryStatus = 'delivering' | 'failed' | 'queued' | 'succeeded'

/** Durable queue record and delivery audit entry. @public */
export interface WebhookDelivery {
  readonly id: string
  readonly messageId: string
  readonly tenantId: string
  readonly subscriptionId: string
  readonly eventType: string
  readonly endpoint: string
  /** Exact JSON bytes, represented as a string, reused by every attempt. */
  readonly body: string
  /** Signing secret captured when the public event was enqueued. Encrypt it at rest. */
  readonly secret: string
  readonly status: WebhookDeliveryStatus
  readonly attemptCount: number
  readonly nextAttemptAt: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastAttemptAt?: number
  readonly completedAt?: number
  readonly responseStatus?: number
  readonly error?: string
  readonly leaseId?: string
  readonly leaseExpiresAt?: number
}

/** Delivery metadata safe to return through the management API. @public */
export type WebhookDeliveryView = Omit<WebhookDelivery, 'body' | 'secret'>

/** Filter used when a publisher looks up matching subscriptions. @public */
export interface WebhookSubscriptionQuery {
  readonly tenantId: string
  readonly event?: string
  readonly status?: WebhookSubscriptionStatus
}

/** Filter used by the delivery-log API. @public */
export interface WebhookDeliveryQuery {
  readonly tenantId: string
  readonly subscriptionId: string
  readonly status?: WebhookDeliveryStatus
  readonly limit?: number
}

/** Atomic result of adding delivery records to the durable queue. @public */
export interface WebhookEnqueueResult {
  readonly enqueued: readonly WebhookDelivery[]
  /** Existing records with the same tenant, subscription, and message id. */
  readonly duplicateCount: number
}

/** Atomic claim request used by delivery workers. @public */
export interface WebhookDeliveryClaim {
  readonly now: number
  readonly limit: number
  readonly leaseId: string
  readonly leaseExpiresAt: number
}

/** Compare-and-set result written after a worker owns a delivery lease. @public */
export type WebhookDeliverySettlement =
  | {
      readonly kind: 'deferred'
      readonly at: number
      readonly nextAttemptAt: number
      readonly error: string
    }
  | {
      readonly kind: 'failed'
      readonly at: number
      readonly attemptCount: number
      readonly error: string
      readonly responseStatus?: number
    }
  | {
      readonly kind: 'retry'
      readonly at: number
      readonly attemptCount: number
      readonly nextAttemptAt: number
      readonly error: string
      readonly responseStatus?: number
    }
  | {
      readonly kind: 'succeeded'
      readonly at: number
      readonly attemptCount: number
      readonly responseStatus: number
    }

/** Storage contract for subscriptions, the durable delivery queue, and its audit log. @public */
export interface WebhookStore {
  createSubscription(subscription: WebhookSubscription): APIMaybePromise<void>
  getSubscription(
    tenantId: string,
    subscriptionId: string,
  ): APIMaybePromise<WebhookSubscription | undefined>
  listSubscriptions(
    query: WebhookSubscriptionQuery,
  ): APIMaybePromise<readonly WebhookSubscription[]>
  updateSubscription(
    tenantId: string,
    subscriptionId: string,
    patch: WebhookSubscriptionPatch,
  ): APIMaybePromise<WebhookSubscription | undefined>
  rotateSubscriptionSecret(
    tenantId: string,
    subscriptionId: string,
    secret: string,
    updatedAt: number,
  ): APIMaybePromise<WebhookSubscription | undefined>
  deleteSubscription(tenantId: string, subscriptionId: string): APIMaybePromise<boolean>
  enqueueDeliveries(deliveries: readonly WebhookDelivery[]): APIMaybePromise<WebhookEnqueueResult>
  claimDeliveries(claim: WebhookDeliveryClaim): APIMaybePromise<readonly WebhookDelivery[]>
  settleDelivery(
    deliveryId: string,
    leaseId: string,
    settlement: WebhookDeliverySettlement,
  ): APIMaybePromise<boolean>
  listDeliveries(query: WebhookDeliveryQuery): APIMaybePromise<readonly WebhookDelivery[]>
  retryDelivery(
    tenantId: string,
    subscriptionId: string,
    deliveryId: string,
    now: number,
  ): APIMaybePromise<WebhookDelivery | undefined>
}

/** Subscription management operation passed to authorization callbacks. @public */
export type WebhookSubscriptionOperation =
  | 'delivery:list'
  | 'delivery:retry'
  | 'subscription:create'
  | 'subscription:delete'
  | 'subscription:list'
  | 'subscription:read'
  | 'subscription:rotate-secret'
  | 'subscription:update'

/** Context passed to subscription authorization callbacks. @public */
export interface WebhookSubscriptionAuthorizationContext<P> {
  readonly request: Request
  readonly identity: ScopeIdentity<P>
  readonly requiredScopes: readonly string[]
  readonly operation: WebhookSubscriptionOperation
  readonly subscriptionId?: string
  readonly deliveryId?: string
}

/** Scope overrides for the subscription and delivery-log API. @public */
export interface WebhookSubscriptionScopes {
  /** Defaults to `<id>:webhooks:read`. */
  readonly read?: readonly string[]
  /** Defaults to `<id>:webhooks:write`. */
  readonly write?: readonly string[]
}

/** Context for an application-specific endpoint policy. @public */
export interface WebhookEndpointPolicyContext {
  readonly url: URL
  readonly tenantId: string
  readonly phase: 'create' | 'deliver' | 'update'
  readonly subscriptionId?: string
}

/** Endpoint validation rules applied during registration and again before delivery. @public */
export interface WebhookEndpointPolicy {
  /** HTTPS is required by default. Enable this only for controlled development networks. */
  readonly allowHTTP?: boolean
  /** Add DNS resolution, tenant allowlists, or other deployment-specific checks. */
  readonly validate?: (context: WebhookEndpointPolicyContext) => APIMaybePromise<boolean>
}

/** Retry, lease, and HTTP settings for the delivery worker. @public */
export interface WebhookDeliveryOptions {
  /** Total attempts, including the first request. Defaults to 8. */
  readonly maxAttempts?: number
  /** Delay after a failed attempt. Defaults to capped exponential backoff from 30 seconds. */
  readonly backoff?: number | readonly number[] | ((attempt: number) => number)
  /** Per-request timeout. Defaults to 10 seconds. */
  readonly timeoutMs?: number
  /** Claim lease. Defaults to 30 seconds. */
  readonly leaseMs?: number
  /** Deferred check for a paused subscription. Defaults to 60 seconds. */
  readonly pausedDelayMs?: number
  /** Maximum Retry-After or backoff delay. Defaults to 24 hours. */
  readonly maxDelayMs?: number
  /** Disable a subscription after its delivery exhausts retries. Defaults to `true`. */
  readonly disableOnExhaustion?: boolean
  readonly fetch?: typeof globalThis.fetch
}

/** Injectable id and secret generators. @public */
export interface WebhookIdentifierOptions {
  readonly subscription?: () => string
  readonly event?: () => string
  readonly delivery?: () => string
  readonly lease?: () => string
  readonly secret?: () => string
}

/** Unexpected outbound failure reported to an observer. @public */
export interface OutboundWebhookFailureContext {
  readonly operation: 'api' | 'deliver' | 'publish'
  readonly tenantId?: string
  readonly eventType?: string
  readonly eventId?: string
  readonly subscriptionId?: string
  readonly deliveryId?: string
  readonly request?: Request
}

/** Outbound subscriptions: the public events, their store, and the tenant management API. @public */
export interface WebhookSubscriptionsOptions<E extends OutboundWebhookEvents, P> {
  /** Namespace for paths, scopes, schema names and operation ids. */
  readonly id: string
  /** The allowlist of public events and the schemas of their data. */
  readonly events: E
  readonly store: WebhookStore
  /** Authenticates tenants of the management API. */
  readonly auth: Pick<ScopeProvider<P>, 'authenticate' | 'documentation'>
  /** Management API prefix. Defaults to `/subscriptions/<id>`. */
  readonly path?: string
  readonly scopes?: WebhookSubscriptionScopes
  /** A policy beyond exact scope matching. */
  readonly authorize?: (
    context: WebhookSubscriptionAuthorizationContext<P>,
  ) => APIMaybePromise<boolean>
  /** Maximum JSON request size. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number
  readonly endpointPolicy?: WebhookEndpointPolicy
  readonly delivery?: WebhookDeliveryOptions
  readonly identifiers?: WebhookIdentifierOptions
  readonly clock?: () => Date
  readonly onError?: (
    error: unknown,
    context: OutboundWebhookFailureContext,
  ) => APIMaybePromise<void>
}

/** Expected rejection returned before an outbound public event reaches the durable queue. @public */
export interface WebhookPublishRejected {
  readonly ok: false
  readonly code:
    | 'WEBHOOK_EVENT_INVALID'
    | 'WEBHOOK_EVENT_NOT_DECLARED'
    | 'WEBHOOK_EVENT_NOT_SERIALIZABLE'
  readonly message: string
  readonly issues?: readonly Readonly<{ message: string; path?: readonly PropertyKey[] }>[]
}

/** Successful durable fan-out result. @public */
export interface WebhookPublished {
  readonly ok: true
  readonly eventId: string
  readonly matchedSubscriptions: number
  readonly enqueuedDeliveries: number
  readonly duplicateDeliveries: number
  readonly deliveryIds: readonly string[]
}

/** Result of publishing one typed public event. @public */
export type WebhookPublishResult = WebhookPublishRejected | WebhookPublished

/** Result of one claimed delivery attempt. @public */
export interface WebhookDeliveryOutcome {
  readonly deliveryId: string
  readonly subscriptionId: string
  readonly status: 'deferred' | 'failed' | 'retrying' | 'succeeded'
  readonly attemptCount: number
  readonly responseStatus?: number
  readonly nextAttemptAt?: number
  readonly error?: string
}

/** Options for one worker drain. @public */
export interface WebhookWorkOptions {
  readonly limit?: number
  readonly concurrency?: number
  /** Unique token for this drain. Defaults to a generated UUID. */
  readonly leaseId?: string
}

/** Result of one worker drain. @public */
export interface WebhookWorkResult {
  readonly claimed: number
  readonly outcomes: readonly WebhookDeliveryOutcome[]
}

/**
 * A configured outbound webhook publisher, management API, durable queue, and worker. It is an
 * `HTTPSource`: serve it with `combineHTTP([http, subscriptions])`; its OpenAPI `webhooks`
 * section documents every public event.
 * @public
 */
export interface WebhookSubscriptions<E extends OutboundWebhookEvents, P> extends HTTPSource {
  readonly id: string
  readonly events: E
  publish(event: OutboundWebhookEvent<E>): Promise<WebhookPublishResult>
  work(options?: WebhookWorkOptions): Promise<WebhookWorkResult>
  readonly '~types': { readonly principal: P } | undefined
}
