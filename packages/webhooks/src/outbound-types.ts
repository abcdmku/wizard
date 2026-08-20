import type { AnyFlow, FlowRun, RunEvent, RunEventType } from '@openwizard/core'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ScopeIdentity, ScopeProvider } from './api-types'
import type { AnyHTTPResource } from './http'

/** A value or promise-like value returned by an outbound webhook adapter. @public */
export type OutboundWebhookMaybePromise<T> = T | PromiseLike<T>

/** Public outbound event names and the Standard Schemas for their data. @public */
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
    /** Stable producer id. Reuse it if publishing the same committed event again. */
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
  createSubscription(subscription: WebhookSubscription): OutboundWebhookMaybePromise<void>
  getSubscription(
    tenantId: string,
    subscriptionId: string,
  ): OutboundWebhookMaybePromise<WebhookSubscription | undefined>
  listSubscriptions(
    query: WebhookSubscriptionQuery,
  ): OutboundWebhookMaybePromise<readonly WebhookSubscription[]>
  updateSubscription(
    tenantId: string,
    subscriptionId: string,
    patch: WebhookSubscriptionPatch,
  ): OutboundWebhookMaybePromise<WebhookSubscription | undefined>
  rotateSubscriptionSecret(
    tenantId: string,
    subscriptionId: string,
    secret: string,
    updatedAt: number,
  ): OutboundWebhookMaybePromise<WebhookSubscription | undefined>
  deleteSubscription(tenantId: string, subscriptionId: string): OutboundWebhookMaybePromise<boolean>
  enqueueDeliveries(
    deliveries: readonly WebhookDelivery[],
  ): OutboundWebhookMaybePromise<WebhookEnqueueResult>
  claimDeliveries(
    claim: WebhookDeliveryClaim,
  ): OutboundWebhookMaybePromise<readonly WebhookDelivery[]>
  settleDelivery(
    deliveryId: string,
    leaseId: string,
    settlement: WebhookDeliverySettlement,
  ): OutboundWebhookMaybePromise<boolean>
  listDeliveries(
    query: WebhookDeliveryQuery,
  ): OutboundWebhookMaybePromise<readonly WebhookDelivery[]>
  retryDelivery(
    tenantId: string,
    subscriptionId: string,
    deliveryId: string,
    now: number,
  ): OutboundWebhookMaybePromise<WebhookDelivery | undefined>
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
  readonly tenantId: string
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

/** OpenAPI text and schemas for the subscription API. @public */
export interface WebhookSubscriptionDocumentation {
  readonly tags?: readonly string[]
  readonly createSummary?: string
  readonly listSummary?: string
  readonly readSummary?: string
  readonly updateSummary?: string
  readonly deleteSummary?: string
  readonly rotateSecretSummary?: string
  readonly deliveriesSummary?: string
  readonly retryDeliverySummary?: string
}

/** Authenticated HTTP API used by tenants to manage callback subscriptions. @public */
export interface WebhookSubscriptionAPIOptions<P> {
  readonly auth: Pick<ScopeProvider<P>, 'authenticate' | 'documentation'>
  /** Runtime base path. Defaults to `/api/webhook-subscriptions`. */
  readonly path?: string
  readonly scopes?: WebhookSubscriptionScopes
  readonly authorize?: (
    context: WebhookSubscriptionAuthorizationContext<P>,
  ) => OutboundWebhookMaybePromise<boolean>
  /** Maximum JSON request size. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number
  readonly docs?: WebhookSubscriptionDocumentation
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
  readonly validate?: (
    context: WebhookEndpointPolicyContext,
  ) => OutboundWebhookMaybePromise<boolean>
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
  readonly runId?: string
  readonly eventType?: string
  readonly eventId?: string
  readonly subscriptionId?: string
  readonly deliveryId?: string
  readonly request?: Request
}

/** Complete outbound subscription system configuration. @public */
export interface WebhookSubscriptionsOptions<E extends OutboundWebhookEvents, P> {
  readonly id: string
  readonly events: E
  readonly store: WebhookStore
  readonly api: WebhookSubscriptionAPIOptions<P>
  readonly endpointPolicy?: WebhookEndpointPolicy
  readonly delivery?: WebhookDeliveryOptions
  readonly identifiers?: WebhookIdentifierOptions
  readonly clock?: () => Date
  readonly onError?: (
    error: unknown,
    context: OutboundWebhookFailureContext,
  ) => OutboundWebhookMaybePromise<void>
}

/** Configuration for outbound webhooks inherited from a flow's committed event stream. @public */
export interface RunWebhookSubscriptionsOptions<P> {
  /** Defaults to the flow name. */
  readonly id?: string
  /** Machine events available to subscribers. Defaults to every event. */
  readonly events?: 'inherit' | readonly RunEventType[]
  readonly store: WebhookStore
  /** Subscription API options. The path defaults to `/api/<id>/webhooks`. */
  readonly api: WebhookSubscriptionAPIOptions<P>
  readonly endpointPolicy?: WebhookEndpointPolicy
  readonly delivery?: WebhookDeliveryOptions
  readonly identifiers?: WebhookIdentifierOptions
  readonly clock?: () => Date
  readonly onError?: (
    error: unknown,
    context: OutboundWebhookFailureContext,
  ) => OutboundWebhookMaybePromise<void>
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

/** A configured outbound webhook publisher, management API, durable queue, and worker. @public */
export interface WebhookSubscriptions<E extends OutboundWebhookEvents, P> {
  readonly id: string
  readonly events: E
  readonly resources: readonly AnyHTTPResource[]
  publish(event: OutboundWebhookEvent<E>): Promise<WebhookPublishResult>
  work(options?: WebhookWorkOptions): Promise<WebhookWorkResult>
  readonly '~types': { readonly principal: P } | undefined
}

/** One committed run event published through the durable outbound queue. @public */
export interface RunWebhookPublishInput<F extends AnyFlow> {
  readonly tenantId: string
  readonly runId: string
  readonly event: RunEvent<F>
  /** Stable producer id. Generated when absent. */
  readonly eventId?: string
}

/** Handle returned when a run event stream is attached to outbound delivery. @public */
export interface RunWebhookAttachment {
  /** Stop observing new events. Already queued publications continue. */
  dispose(): void
  /** Wait until every event observed so far has reached the durable queue. */
  flush(): Promise<void>
}

/** Outbound subscriptions driven directly by a typed OpenWizard run event stream. @public */
export interface RunWebhookSubscriptions<F extends AnyFlow, P> {
  readonly id: string
  readonly flow: F
  readonly events: readonly RunEventType[]
  readonly resources: readonly AnyHTTPResource[]
  publish(input: RunWebhookPublishInput<F>): Promise<WebhookPublishResult>
  attach(run: FlowRun<F>, options: { readonly tenantId: string }): RunWebhookAttachment
  work(options?: WebhookWorkOptions): Promise<WebhookWorkResult>
  readonly '~types': { readonly principal: P } | undefined
}

/** Structural subset accepted by `createHTTP`. @public */
export interface AnyWebhookSubscriptions {
  readonly id: string
  readonly resources: readonly AnyHTTPResource[]
}
