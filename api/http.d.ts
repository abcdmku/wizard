import { AnyWizard, ChildStepId, Command, CommandResult, ContextInput, Ctx, EventType, Projection, ProjectionDefinition, Run, RunStepId, SendResult, StepId, ViewId } from "@openwizard/core";
import { StandardSchemaV1 } from "@standard-schema/spec";
//#region src/auth.d.ts
/** A value or promise-like value returned by an HTTP callback. @public */
type APIMaybePromise<T> = T | PromiseLike<T>;
/** An authenticated tenant, caller, and the exact scopes granted to it. @public */
interface ScopeIdentity<P> {
  readonly tenantId: string;
  readonly principal: P;
  readonly scopes: readonly string[];
}
/** The generated API operation a request targets. @public */
type HTTPOperation = 'command' | 'create' | 'event' | 'read' | 'stream';
/** Request context passed to a scope provider's authorization policy. @public */
interface ScopeAuthorizationContext<P> {
  readonly request: Request;
  readonly identity: ScopeIdentity<P>;
  readonly requiredScopes: readonly string[];
  readonly operation: HTTPOperation;
  /** Absent for `create`. */
  readonly runId?: string;
}
/** OpenAPI and HTTP challenge metadata for a scope provider. @public */
interface ScopeProviderDocumentation {
  readonly schemeName: string;
  readonly securityScheme: Readonly<Record<string, unknown>>;
  readonly challenge?: string;
}
/** Pluggable authentication and scope authorization for generated routes. @public */
interface ScopeProvider<P> {
  /** Authenticate the request. Return `null` for a missing, expired, or invalid credential. */
  authenticate(request: Request): APIMaybePromise<ScopeIdentity<P> | null>;
  /** Defaults to requiring every scope in `requiredScopes` by exact string match. */
  authorize?(context: ScopeAuthorizationContext<P>): APIMaybePromise<boolean>;
  readonly documentation: ScopeProviderDocumentation;
}
//#endregion
//#region src/cors.d.ts
/**
 * Cross-origin access for browser clients (a Mirror over `httpTransport`, a SPA calling the run
 * routes from another origin).
 * @public
 */
interface CORSOptions {
  /** Origins allowed to call the routes (`https://app.example.com`), or `'*'` for any origin. */
  readonly origins: '*' | readonly string[];
  /** Send `Access-Control-Allow-Credentials: true` (cookies). Requires an explicit origin list. */
  readonly credentials?: boolean;
  /** How long a browser may cache a preflight answer. Defaults to 600 seconds. */
  readonly maxAgeSeconds?: number;
}
//#endregion
//#region src/openapi-types.d.ts
/** A JSON Schema (draft 2020-12, the OpenAPI 3.1 dialect) object. @public */
type JSONSchema = {
  readonly [keyword: string]: unknown;
};
/** An OpenAPI 3.1 operation object as generated for one route or outbound callback. @public */
interface OpenAPIOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly parameters?: readonly JSONSchema[];
  readonly requestBody?: JSONSchema;
  readonly responses: {
    readonly [status: string]: JSONSchema;
  };
  readonly security?: readonly {
    readonly [scheme: string]: readonly string[];
  }[];
  /** Fern SDK namespace, dot-separated (`checkout.runs`). Forge and Fern group methods by it. */
  readonly 'x-fern-sdk-group-name': string;
  /** Fern SDK method name inside its group (`get`, `create`, `sendPaymentCaptured`). */
  readonly 'x-fern-sdk-method-name': string;
  readonly [extension: `x-${string}`]: unknown;
}
/** An OpenAPI tag with its description. @public */
interface OpenAPITag {
  readonly name: string;
  readonly description?: string;
}
/**
 * Components, outbound callbacks and tags contributed by one HTTP source. Names are global in
 * the document: equal definitions merge, different definitions under one name are an error.
 * @public
 */
interface OpenAPIContribution {
  readonly schemas: {
    readonly [name: string]: JSONSchema;
  };
  readonly securitySchemes: {
    readonly [name: string]: JSONSchema;
  };
  /** OpenAPI 3.1 `webhooks`: outbound callbacks this API sends to subscribers. */
  readonly webhooks: {
    readonly [name: string]: {
      readonly post: OpenAPIOperation;
    };
  };
  readonly tags: readonly OpenAPITag[];
}
/** Document-level metadata passed to `createOpenAPIDocument` / `http.openAPI`. @public */
interface OpenAPIInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly servers?: readonly {
    readonly url: string;
    readonly description?: string;
  }[];
}
/** A complete OpenAPI 3.1 document. @public */
interface OpenAPIDocument {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly {
    readonly url: string;
    readonly description?: string;
  }[];
  readonly tags: readonly OpenAPITag[];
  readonly paths: {
    readonly [path: string]: {
      readonly [method: string]: OpenAPIOperation;
    };
  };
  readonly webhooks?: {
    readonly [name: string]: {
      readonly post: OpenAPIOperation;
    };
  };
  readonly components: {
    readonly schemas: {
      readonly [name: string]: JSONSchema;
    };
    readonly securitySchemes?: {
      readonly [name: string]: JSONSchema;
    };
  };
}
//#endregion
//#region src/http.d.ts
/** HTTP methods used by generated OpenWizard routes. @public */
type HTTPResourceMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';
/**
 * One generated route: a framework-neutral handler plus its OpenAPI operation.
 * `path` uses `:name` parameters; the OpenAPI path is derived from it. A route without
 * `openAPI` is served but left out of the document (the Mirror wire POST).
 * @public
 */
interface AnyHTTPResource {
  readonly id: string;
  readonly method: HTTPResourceMethod;
  readonly path: string;
  readonly openAPI?: OpenAPIOperation;
  handle(request: Request): Promise<Response>;
}
/**
 * Routes plus the OpenAPI components they reference: what `createHTTP` and
 * `createWebhookSubscriptions` return, and what `combineHTTP` composes.
 * @public
 */
interface HTTPSource {
  readonly resources: readonly AnyHTTPResource[];
  readonly openAPIComponents: OpenAPIContribution;
}
/**
 * A servable set of routes. `fetch` routes a request (JSON 404/405 otherwise, OPTIONS answered
 * for CORS preflight); `openAPI` returns the OpenAPI 3.1 document of every documented route.
 * @public
 */
interface HTTPHandler extends HTTPSource {
  fetch(request: Request): Promise<Response>;
  openAPI(info: OpenAPIInfo): OpenAPIDocument;
}
/**
 * The error body of every generated route. `code` is stable; `message` is for humans;
 * `issues` lists validation problems; `requiredScopes` names the scopes a 403 needed.
 * @public
 */
interface HTTPErrorBody {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly {
    readonly message: string;
    readonly path?: readonly unknown[];
  }[];
  readonly requiredScopes?: readonly string[];
}
//#endregion
//#region src/combine.d.ts
/** Options of `combineHTTP`. @public */
interface CombineHTTPOptions {
  /** Cross-origin access for browser clients. Off by default. */
  readonly cors?: CORSOptions;
}
/**
 * Serve several sources (`createHTTP` results, `createWebhookSubscriptions`) as one handler with
 * one OpenAPI document. Duplicate routes, resource ids, operation ids and conflicting component
 * definitions throw here, at startup.
 * @public
 */
declare function combineHTTP(sources: readonly HTTPSource[], options?: CombineHTTPOptions): HTTPHandler;
//#endregion
//#region src/run-handle.d.ts
/** A refusal of a durable host's own gate (lease, version, dedupe), not of the flow. @public */
interface DurableHostFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}
/**
 * A multi-owner host such as `@openwizard/durable`'s `DurableRunHost`. When `runs` or a
 * receiver's `resolve` returns one, HTTP commands and events go through its lease, version and
 * dedupe checks: a SHA-256 of the scoped `Idempotency-Key` (or receiver `webhook-id`) becomes the
 * command or event id.
 * @public
 */
interface DurableRunHandle<F extends AnyWizard> {
  readonly run: Run<F>;
  dispatch(command: Command<F>, options: {
    readonly commandId: string;
    readonly digest?: string;
    readonly expectedVersion?: {
      readonly epoch: number;
      readonly seq: number;
    };
  }): Promise<{
    readonly ok: true;
    readonly result: CommandResult;
  } | DurableHostFailure>;
  send(event: EventType<F>, payload: unknown, options: {
    readonly eventId: string;
    readonly correlationId?: string;
  }): Promise<SendResult | DurableHostFailure>;
}
/** What a data layer or resolver may return: a live run, or a durable host that owns one. @public */
type RunHandle<F extends AnyWizard> = Run<F> | DurableRunHandle<F>;
//#endregion
//#region src/idempotency.d.ts
/** A response stored under an idempotency key and replayed for repeats. @public */
interface IdempotentResponse {
  readonly status: number;
  readonly body: string;
}
/** Result of claiming an idempotency key. @public */
type IdempotencyClaim = {
  readonly state: 'claimed';
  readonly claimId: string;
} | {
  readonly state: 'pending';
  readonly fingerprint: string;
} | {
  readonly state: 'completed';
  readonly fingerprint: string;
  readonly response: IdempotentResponse;
};
/**
 * Atomic idempotency records shared by signed receivers (keyed by `webhook-id`) and API writes
 * (keyed by the `Idempotency-Key` header), scoped per API and tenant. `fingerprint` identifies
 * the request so a key reused for a different request is detected.
 * @public
 */
interface IdempotencyStore {
  /** Claim `key` with a fresh identity, or report its existing pending or completed claim. */
  claim(key: string, fingerprint: string): IdempotencyClaim | PromiseLike<IdempotencyClaim>;
  /**
   * Atomically store the response only if this live pending key still belongs to `claimId`.
   * Return false after expiration, eviction, completion, or replacement. Never alter a newer claim.
   */
  complete(key: string, claimId: string, response: IdempotentResponse): boolean | PromiseLike<boolean>;
  /** Atomically drop only this live pending claim; return false if it no longer owns the key. */
  release(key: string, claimId: string): boolean | PromiseLike<boolean>;
}
/** Options of `createMemoryIdempotencyStore`. @public */
interface MemoryIdempotencyStoreOptions {
  /** How long a key is remembered. Defaults to 24 hours; keep it above the receiver replay window. */
  readonly ttlMs?: number;
  /** Oldest keys are evicted beyond this count. Defaults to 10 000. */
  readonly maxEntries?: number;
  readonly now?: () => number;
}
/**
 * In-process idempotency store. It only deduplicates within one process: share a database-backed
 * store (or a durable host) when several processes serve the same routes.
 * @public
 */
declare function createMemoryIdempotencyStore(options?: MemoryIdempotencyStoreOptions): IdempotencyStore;
//#endregion
//#region src/receive-types.d.ts
/** The signed JSON envelope a receiver accepts. @public */
interface StandardWebhookEnvelope<E extends string = string, D = unknown> {
  /** Dot-delimited event type. It must match the receiver's declared event. */
  readonly type: E;
  /** ISO 8601 time at which the producer created the event. */
  readonly timestamp: string;
  /** Event payload. The flow's event boundary parses it before a handler sees it. */
  readonly data: D;
  /** Optional run key, also the default correlation id. */
  readonly subject?: string;
}
/** Unverified signature headers available while selecting the signing secret. @public */
interface WebhookSignatureContext {
  readonly request: Request;
  readonly event: string;
  readonly webhookId: string | null;
  readonly webhookTimestamp: string | null;
  readonly webhookSignature: string | null;
}
/**
 * `whsec_` secret(s) of a receiver: one, several during a rotation (any one may sign), or a
 * selector per request (per event or per tenant).
 * @public
 */
type WebhookSecret = string | readonly string[] | ((context: WebhookSignatureContext) => APIMaybePromise<string | readonly string[]>);
/** A verified delivery passed to run resolution and correlation callbacks. @public */
interface VerifiedWebhookDelivery<E extends string = string> {
  readonly request: Request;
  /** The `webhook-id` header: the message id, reused by every retry of one message. */
  readonly webhookId: string;
  /** Delivery-attempt time from the signed `webhook-timestamp` header. */
  readonly attemptTimestamp: Date;
  /** The verified envelope. `data` stays untrusted until the flow's event boundary parses it. */
  readonly envelope: StandardWebhookEnvelope<E, unknown>;
}
/**
 * Signed Standard Webhooks receivers: one `POST <path>/<event>` route per listed event. The
 * `webhook-id` is the event id, so a redelivered message is accepted once.
 * @public
 */
interface ReceiverOptions<F extends AnyWizard> {
  /** The events senders may deliver. Nothing is received unless it is listed. */
  readonly events: readonly EventType<F>[];
  readonly secret: WebhookSecret;
  /** Find the run (or durable host) a verified delivery is for. Enforce tenancy here. */
  readonly resolve: (delivery: VerifiedWebhookDelivery<EventType<F>>) => APIMaybePromise<RunHandle<F> | null | undefined>;
  /** The correlation id sent with the event. Defaults to the envelope `subject`. */
  readonly correlationId?: (delivery: VerifiedWebhookDelivery<EventType<F>>) => APIMaybePromise<string | undefined>;
  /** Route prefix. Defaults to `/webhooks/<id>`. */
  readonly path?: string;
  /** Accepted distance between `webhook-timestamp` and now. Defaults to 300 seconds. */
  readonly toleranceSeconds?: number;
  /** Maximum body size. Defaults to 1 MiB. */
  readonly maxBodyBytes?: number;
}
//#endregion
//#region src/http-options.d.ts
/** Flow capabilities an API can expose. `create` adds `POST <base>`; the reads add `GET <base>/:runId` and its stream. @public */
type FlowAccess = 'back' | 'cancel' | 'compensate' | 'create' | 'next' | 'output' | 'progress' | 'read' | 'reset' | 'startReady' | 'start';
/** Capabilities available on a specific step, narrowed by kind and capabilities. @public */
type StepAccessFor<F extends AnyWizard, K extends StepId<F>> = 'error' | 'invalidate' | 'issues' | 'output' | 'read' | 'skip' | (K extends ViewId<F> ? 'go' | 'input' | 'resetInput' | 'setInput' : never) | (K extends RunStepId<F> ? 'retry' | 'startStep' : never) | (K extends ChildStepId<F> ? 'child' | 'summary' : never);
/** What the API exposes. Nothing is exposed unless it is listed here. @public */
interface HTTPAccess<F extends AnyWizard> {
  /** Context keys returned by the run routes. */
  readonly context?: readonly (keyof Ctx<F> & string)[];
  readonly flow?: readonly FlowAccess[];
  readonly steps?: { readonly [K in StepId<F>]?: readonly StepAccessFor<F, K>[]; };
  /** Declared events that callers may send through `POST <base>/:runId/events/<event>`. */
  readonly events?: readonly EventType<F>[];
}
/** Scope overrides. Defaults: `<id>:read`, `<id>:create`, `<id>:command`. @public */
interface HTTPScopes {
  readonly read?: readonly string[];
  readonly create?: readonly string[];
  /** Commands and event sends. */
  readonly command?: readonly string[];
}
/** Authenticated lookup of one run. @public */
interface RunLookup<P> {
  readonly request: Request;
  readonly tenantId: string;
  readonly principal: P;
  readonly runId: string;
}
/** Authenticated creation of one run; `input` passed the flow's context boundary. @public */
interface RunCreation<F extends AnyWizard, P> {
  readonly request: Request;
  readonly tenantId: string;
  readonly principal: P;
  readonly input: ContextInput<F>;
  /** The request's `Idempotency-Key`, a natural run id for retried creates. */
  readonly idempotencyKey?: string;
}
/** Tenant-scoped run storage behind the generated API. @public */
interface RunDataLayer<F extends AnyWizard, P> {
  /** The one live owner of the run (a `Run`, or a durable host that owns it). */
  get(lookup: RunLookup<P>): APIMaybePromise<RunHandle<F> | null | undefined>;
  /** Create (and usually start) a run. Required by the `create` capability. */
  create?(creation: RunCreation<F, P>): APIMaybePromise<RunHandle<F>>;
}
/** Where an unexpected failure happened, as reported to `onError`. @public */
interface HTTPFailureContext {
  readonly request: Request;
  readonly operation: HTTPOperation | 'receive';
  readonly runId?: string;
  readonly event?: string;
  readonly webhookId?: string;
}
/**
 * The run API of `createHTTP`: `runs`, `auth` and `access` turn it on together. Access is
 * deny-by-default: only the listed capabilities become routes.
 * @public
 */
interface HTTPRunAPIOptions<F extends AnyWizard, S, P> {
  /** Finds (and, with the `create` capability, creates) the tenant's runs. */
  readonly runs: RunDataLayer<F, P>;
  readonly auth: ScopeProvider<P>;
  readonly access: HTTPAccess<F>;
  /** Replaces the projection derived from `access` for the run routes and stream. */
  readonly projection?: Projection<F, S> | Projection<ProjectionDefinition<F>, S>;
  /** Route prefix. Defaults to `/api/<id>`. */
  readonly path?: string;
  readonly scopes?: HTTPScopes;
  /** Maximum JSON body size. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
}
type WithoutRunAPI = { readonly [K in keyof HTTPRunAPIOptions<AnyWizard, unknown, unknown>]?: never; };
/** Options of `createHTTP`: the run API, signed receivers, or both. @public */
type CreateHTTPOptions<F extends AnyWizard, S, P> = (HTTPRunAPIOptions<F, S, P> | WithoutRunAPI) & {
  /** Namespace for paths, scopes, schema names and operation ids. Defaults to the flow name. */
  readonly id?: string;
  /** Signed Standard Webhooks receivers for the flow's events. */
  readonly receive?: ReceiverOptions<F>;
  /**
   * Replays the response of a repeated `Idempotency-Key` or `webhook-id`. Defaults to an
   * in-process store; share one across processes (or return durable hosts from `runs`) when
   * several processes serve the same routes.
   */
  readonly idempotency?: IdempotencyStore;
  /** Cross-origin access for browser clients. Off by default. */
  readonly cors?: CORSOptions;
  /** Observes unexpected failures; the caller still gets a stable 500. */
  readonly onError?: (error: unknown, context: HTTPFailureContext) => APIMaybePromise<void>;
};
/** Generated routes and documentation for one flow. @public */
interface WizardHTTP<F extends AnyWizard = AnyWizard> extends HTTPHandler {
  readonly id: string;
  readonly wizard: F;
}
//#endregion
//#region src/create-http.d.ts
/**
 * Generate the HTTP routes and the OpenAPI 3.1 document of a flow: the run API (`runs`,
 * `auth` and deny-by-default `access` together) and/or signed receivers (`receive`). The result
 * is framework-neutral: serve `http.fetch` from any `Request → Response` runtime and
 * `http.openAPI(info)` as the document.
 * @public
 */
declare function createHTTP<F extends AnyWizard, S = unknown, P = unknown>(wizard: F, options: CreateHTTPOptions<F, S, P>): WizardHTTP<F>;
//#endregion
//#region src/endpoint.d.ts
/** Options for the built-in outbound webhook endpoint check. @public */
interface WebhookEndpointValidationOptions {
  /** HTTPS is required unless this development-only escape hatch is enabled. */
  readonly allowHTTP?: boolean;
}
/**
 * Parse an outbound callback URL and reject obvious SSRF targets.
 *
 * This check blocks credentials, local names, and non-public IP literals. Deployments should add
 * DNS resolution through `endpointPolicy.validate` and pin the resolved address in their fetch
 * implementation when DNS rebinding is in scope.
 * @public
 */
declare function validateWebhookEndpoint(endpoint: string, options?: WebhookEndpointValidationOptions): URL;
//#endregion
//#region src/outbound-types.d.ts
/**
 * The public events subscribers may receive, by name, with the Standard Schema of their data.
 * This map is the allowlist: nothing else is ever published.
 * @public
 */
type OutboundWebhookEvents = Readonly<Record<string, StandardSchemaV1>>;
/** Input accepted by one declared outbound event schema. @public */
type OutboundWebhookEventInput<S> = S extends StandardSchemaV1<infer I, unknown> ? I : never;
/** Parsed data stored and delivered for one declared outbound event schema. @public */
type OutboundWebhookEventData<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;
/** One typed public event passed to `WebhookSubscriptions.publish`. @public */
type OutboundWebhookEvent<E extends OutboundWebhookEvents> = { readonly [K in keyof E & string]: {
  /** Stable public event name. Version it when its meaning or data contract changes. */
  readonly type: K;
  readonly data: OutboundWebhookEventInput<E[K]>;
  readonly tenantId: string;
  /** Stable producer id, the `webhook-id` of every delivery. Reuse it to publish the same event again. */
  readonly eventId?: string;
  readonly subject?: string;
  /** Event creation time. Defaults to the publisher clock. */
  readonly timestamp?: Date | string;
}; }[keyof E & string];
/** Lifecycle state of a callback subscription. @public */
type WebhookSubscriptionStatus = 'active' | 'disabled' | 'paused';
/** Stored callback subscription. Stores should encrypt `secret` at rest. @public */
interface WebhookSubscription {
  readonly id: string;
  readonly tenantId: string;
  readonly endpoint: string;
  readonly events: readonly string[];
  readonly status: WebhookSubscriptionStatus;
  readonly secret: string;
  readonly description?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly disabledReason?: string;
}
/** Subscription data safe to return through the management API. @public */
type WebhookSubscriptionView = Omit<WebhookSubscription, 'secret'>;
/** Mutable fields accepted by a subscription store. @public */
interface WebhookSubscriptionPatch {
  readonly endpoint?: string;
  readonly events?: readonly string[];
  readonly status?: WebhookSubscriptionStatus;
  readonly description?: string | null;
  readonly disabledReason?: string | null;
  readonly updatedAt: number;
}
/** Lifecycle state of one queued delivery. @public */
type WebhookDeliveryStatus = 'delivering' | 'failed' | 'queued' | 'succeeded';
/** Durable queue record and delivery audit entry. @public */
interface WebhookDelivery {
  readonly id: string;
  readonly messageId: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly eventType: string;
  readonly endpoint: string;
  /** Exact JSON bytes, represented as a string, reused by every attempt. */
  readonly body: string;
  /** Signing secret captured when the public event was enqueued. Encrypt it at rest. */
  readonly secret: string;
  readonly status: WebhookDeliveryStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAttemptAt?: number;
  readonly completedAt?: number;
  readonly responseStatus?: number;
  readonly error?: string;
  readonly leaseId?: string;
  readonly leaseExpiresAt?: number;
}
/** Delivery metadata safe to return through the management API. @public */
type WebhookDeliveryView = Omit<WebhookDelivery, 'body' | 'secret'>;
/** Filter used when a publisher looks up matching subscriptions. @public */
interface WebhookSubscriptionQuery {
  readonly tenantId: string;
  readonly event?: string;
  readonly status?: WebhookSubscriptionStatus;
}
/** Filter used by the delivery-log API. @public */
interface WebhookDeliveryQuery {
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly status?: WebhookDeliveryStatus;
  readonly limit?: number;
}
/** Atomic result of adding delivery records to the durable queue. @public */
interface WebhookEnqueueResult {
  readonly enqueued: readonly WebhookDelivery[];
  /** Existing records with the same tenant, subscription, and message id. */
  readonly duplicateCount: number;
}
/** Atomic claim request used by delivery workers. @public */
interface WebhookDeliveryClaim {
  readonly now: number;
  readonly limit: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: number;
}
/** Compare-and-set result written after a worker owns a delivery lease. @public */
type WebhookDeliverySettlement = {
  readonly kind: 'deferred';
  readonly at: number;
  readonly nextAttemptAt: number;
  readonly error: string;
} | {
  readonly kind: 'failed';
  readonly at: number;
  readonly attemptCount: number;
  readonly error: string;
  readonly responseStatus?: number;
} | {
  readonly kind: 'retry';
  readonly at: number;
  readonly attemptCount: number;
  readonly nextAttemptAt: number;
  readonly error: string;
  readonly responseStatus?: number;
} | {
  readonly kind: 'succeeded';
  readonly at: number;
  readonly attemptCount: number;
  readonly responseStatus: number;
};
/** Storage contract for subscriptions, the durable delivery queue, and its audit log. @public */
interface WebhookStore {
  createSubscription(subscription: WebhookSubscription): APIMaybePromise<void>;
  getSubscription(tenantId: string, subscriptionId: string): APIMaybePromise<WebhookSubscription | undefined>;
  listSubscriptions(query: WebhookSubscriptionQuery): APIMaybePromise<readonly WebhookSubscription[]>;
  updateSubscription(tenantId: string, subscriptionId: string, patch: WebhookSubscriptionPatch): APIMaybePromise<WebhookSubscription | undefined>;
  rotateSubscriptionSecret(tenantId: string, subscriptionId: string, secret: string, updatedAt: number): APIMaybePromise<WebhookSubscription | undefined>;
  deleteSubscription(tenantId: string, subscriptionId: string): APIMaybePromise<boolean>;
  enqueueDeliveries(deliveries: readonly WebhookDelivery[]): APIMaybePromise<WebhookEnqueueResult>;
  claimDeliveries(claim: WebhookDeliveryClaim): APIMaybePromise<readonly WebhookDelivery[]>;
  settleDelivery(deliveryId: string, leaseId: string, settlement: WebhookDeliverySettlement): APIMaybePromise<boolean>;
  listDeliveries(query: WebhookDeliveryQuery): APIMaybePromise<readonly WebhookDelivery[]>;
  retryDelivery(tenantId: string, subscriptionId: string, deliveryId: string, now: number): APIMaybePromise<WebhookDelivery | undefined>;
}
/** Subscription management operation passed to authorization callbacks. @public */
type WebhookSubscriptionOperation = 'delivery:list' | 'delivery:retry' | 'subscription:create' | 'subscription:delete' | 'subscription:list' | 'subscription:read' | 'subscription:rotate-secret' | 'subscription:update';
/** Context passed to subscription authorization callbacks. @public */
interface WebhookSubscriptionAuthorizationContext<P> {
  readonly request: Request;
  readonly identity: ScopeIdentity<P>;
  readonly requiredScopes: readonly string[];
  readonly operation: WebhookSubscriptionOperation;
  readonly subscriptionId?: string;
  readonly deliveryId?: string;
}
/** Scope overrides for the subscription and delivery-log API. @public */
interface WebhookSubscriptionScopes {
  /** Defaults to `<id>:webhooks:read`. */
  readonly read?: readonly string[];
  /** Defaults to `<id>:webhooks:write`. */
  readonly write?: readonly string[];
}
/** Context for an application-specific endpoint policy. @public */
interface WebhookEndpointPolicyContext {
  readonly url: URL;
  readonly tenantId: string;
  readonly phase: 'create' | 'deliver' | 'update';
  readonly subscriptionId?: string;
}
/** Endpoint validation rules applied during registration and again before delivery. @public */
interface WebhookEndpointPolicy {
  /** HTTPS is required by default. Enable this only for controlled development networks. */
  readonly allowHTTP?: boolean;
  /** Add DNS resolution, tenant allowlists, or other deployment-specific checks. */
  readonly validate?: (context: WebhookEndpointPolicyContext) => APIMaybePromise<boolean>;
}
/** Retry, lease, and HTTP settings for the delivery worker. @public */
interface WebhookDeliveryOptions {
  /** Total attempts, including the first request. Defaults to 8. */
  readonly maxAttempts?: number;
  /** Delay after a failed attempt. Defaults to capped exponential backoff from 30 seconds. */
  readonly backoff?: number | readonly number[] | ((attempt: number) => number);
  /** Per-request timeout. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** Claim lease. Defaults to 30 seconds. */
  readonly leaseMs?: number;
  /** Deferred check for a paused subscription. Defaults to 60 seconds. */
  readonly pausedDelayMs?: number;
  /** Maximum Retry-After or backoff delay. Defaults to 24 hours. */
  readonly maxDelayMs?: number;
  /** Disable a subscription after its delivery exhausts retries. Defaults to `true`. */
  readonly disableOnExhaustion?: boolean;
  readonly fetch?: typeof globalThis.fetch;
}
/** Injectable id and secret generators. @public */
interface WebhookIdentifierOptions {
  readonly subscription?: () => string;
  readonly event?: () => string;
  readonly delivery?: () => string;
  readonly lease?: () => string;
  readonly secret?: () => string;
}
/** Unexpected outbound failure reported to an observer. @public */
interface OutboundWebhookFailureContext {
  readonly operation: 'api' | 'deliver' | 'publish';
  readonly tenantId?: string;
  readonly eventType?: string;
  readonly eventId?: string;
  readonly subscriptionId?: string;
  readonly deliveryId?: string;
  readonly request?: Request;
}
/** Outbound subscriptions: the public events, their store, and the tenant management API. @public */
interface WebhookSubscriptionsOptions<E extends OutboundWebhookEvents, P> {
  /** Namespace for paths, scopes, schema names and operation ids. */
  readonly id: string;
  /** The allowlist of public events and the schemas of their data. */
  readonly events: E;
  readonly store: WebhookStore;
  /** Authenticates tenants of the management API. */
  readonly auth: Pick<ScopeProvider<P>, 'authenticate' | 'documentation'>;
  /** Management API prefix. Defaults to `/subscriptions/<id>`. */
  readonly path?: string;
  readonly scopes?: WebhookSubscriptionScopes;
  /** A policy beyond exact scope matching. */
  readonly authorize?: (context: WebhookSubscriptionAuthorizationContext<P>) => APIMaybePromise<boolean>;
  /** Maximum JSON request size. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
  readonly endpointPolicy?: WebhookEndpointPolicy;
  readonly delivery?: WebhookDeliveryOptions;
  readonly identifiers?: WebhookIdentifierOptions;
  readonly clock?: () => Date;
  readonly onError?: (error: unknown, context: OutboundWebhookFailureContext) => APIMaybePromise<void>;
}
/** Expected rejection returned before an outbound public event reaches the durable queue. @public */
interface WebhookPublishRejected {
  readonly ok: false;
  readonly code: 'WEBHOOK_EVENT_INVALID' | 'WEBHOOK_EVENT_NOT_DECLARED' | 'WEBHOOK_EVENT_NOT_SERIALIZABLE';
  readonly message: string;
  readonly issues?: readonly Readonly<{
    message: string;
    path?: readonly PropertyKey[];
  }>[];
}
/** Successful durable fan-out result. @public */
interface WebhookPublished {
  readonly ok: true;
  readonly eventId: string;
  readonly matchedSubscriptions: number;
  readonly enqueuedDeliveries: number;
  readonly duplicateDeliveries: number;
  readonly deliveryIds: readonly string[];
}
/** Result of publishing one typed public event. @public */
type WebhookPublishResult = WebhookPublishRejected | WebhookPublished;
/** Result of one claimed delivery attempt. @public */
interface WebhookDeliveryOutcome {
  readonly deliveryId: string;
  readonly subscriptionId: string;
  readonly status: 'deferred' | 'failed' | 'retrying' | 'succeeded';
  readonly attemptCount: number;
  readonly responseStatus?: number;
  readonly nextAttemptAt?: number;
  readonly error?: string;
}
/** Options for one worker drain. @public */
interface WebhookWorkOptions {
  readonly limit?: number;
  readonly concurrency?: number;
  /** Unique token for this drain. Defaults to a generated UUID. */
  readonly leaseId?: string;
}
/** Result of one worker drain. @public */
interface WebhookWorkResult {
  readonly claimed: number;
  readonly outcomes: readonly WebhookDeliveryOutcome[];
}
/**
 * A configured outbound webhook publisher, management API, durable queue, and worker. It is an
 * `HTTPSource`: serve it with `combineHTTP([http, subscriptions])`; its OpenAPI `webhooks`
 * section documents every public event.
 * @public
 */
interface WebhookSubscriptions<E extends OutboundWebhookEvents, P> extends HTTPSource {
  readonly id: string;
  readonly events: E;
  publish(event: OutboundWebhookEvent<E>): Promise<WebhookPublishResult>;
  work(options?: WebhookWorkOptions): Promise<WebhookWorkResult>;
  readonly '~types': {
    readonly principal: P;
  } | undefined;
}
//#endregion
//#region src/outbound.d.ts
/**
 * Outbound webhooks for a declared set of public events: `publish` fans an event out to the
 * tenant's active subscriptions through the durable queue, `work` delivers it signed (Standard
 * Webhooks), and the routes let tenants manage their subscriptions and read the delivery log.
 * @public
 */
declare function createWebhookSubscriptions<const E extends OutboundWebhookEvents, P>(options: WebhookSubscriptionsOptions<E, P>): WebhookSubscriptions<E, P>;
//#endregion
//#region src/outbound-store.d.ts
/** In-memory subscription store and delivery queue for tests and local processes. @public */
declare class MemoryWebhookStore implements WebhookStore {
  #private;
  createSubscription(subscription: WebhookSubscription): void;
  getSubscription(tenantId: string, subscriptionId: string): WebhookSubscription | undefined;
  listSubscriptions(query: WebhookSubscriptionQuery): readonly WebhookSubscription[];
  updateSubscription(tenantId: string, subscriptionId: string, patch: WebhookSubscriptionPatch): WebhookSubscription | undefined;
  rotateSubscriptionSecret(tenantId: string, subscriptionId: string, secret: string, updatedAt: number): WebhookSubscription | undefined;
  deleteSubscription(tenantId: string, subscriptionId: string): boolean;
  enqueueDeliveries(deliveries: readonly WebhookDelivery[]): WebhookEnqueueResult;
  claimDeliveries(claim: WebhookDeliveryClaim): readonly WebhookDelivery[];
  settleDelivery(deliveryId: string, leaseId: string, settlement: WebhookDeliverySettlement): boolean;
  listDeliveries(query: WebhookDeliveryQuery): readonly WebhookDelivery[];
  retryDelivery(tenantId: string, subscriptionId: string, deliveryId: string, now: number): WebhookDelivery | undefined;
}
/** Create an in-memory store. Use a durable adapter in production. @public */
declare function createMemoryWebhookStore(): MemoryWebhookStore;
//#endregion
//#region src/scopes.d.ts
/** Options for a scope provider that authenticates HTTP bearer tokens. @public */
interface BearerScopeProviderOptions<P> {
  /** Verify a token and return its tenant, principal, and granted scopes. Return `null` to reject it. */
  readonly verify: (token: string, request: Request) => APIMaybePromise<ScopeIdentity<P> | null>;
  /** OpenAPI security-scheme name. Defaults to `bearerAuth`. */
  readonly schemeName?: string;
  /** OpenAPI bearer format, such as `JWT`. */
  readonly bearerFormat?: string;
  /** Value sent in `WWW-Authenticate`. Defaults to `Bearer`. */
  readonly challenge?: string;
  /** Optional policy beyond exact required-scope matching. */
  readonly authorize?: ScopeProvider<P>['authorize'];
}
/** Options for bearer authentication documented as an OpenAPI OAuth 2 security scheme. @public */
interface OAuth2ScopeProviderOptions<P> {
  /** Verify an OAuth access token and return its tenant, subject, and granted scopes. */
  readonly verify: (token: string, request: Request) => APIMaybePromise<ScopeIdentity<P> | null>;
  /**
   * OpenAPI OAuth flow definitions, such as `authorizationCode` or `clientCredentials`. The
   * scopes the generated routes require are added to every flow's `scopes`.
   */
  readonly flows: Readonly<Record<string, unknown>>;
  /** OpenAPI security-scheme name. Defaults to `oauth2`. */
  readonly schemeName?: string;
  /** Value sent in `WWW-Authenticate`. Defaults to `Bearer`. */
  readonly challenge?: string;
  /** Optional policy beyond exact required-scope matching. */
  readonly authorize?: ScopeProvider<P>['authorize'];
}
/** Create a scope provider backed by the HTTP `Authorization: Bearer` header. @public */
declare function createBearerScopeProvider<P>(options: BearerScopeProviderOptions<P>): ScopeProvider<P>;
/** Create an OAuth 2 scope provider whose flows and required scopes appear in OpenAPI. @public */
declare function createOAuth2ScopeProvider<P>(options: OAuth2ScopeProviderOptions<P>): ScopeProvider<P>;
//#endregion
//#region src/signature.d.ts
/**
 * Standard Webhooks signing and verification over Web Crypto (HMAC-SHA256), so every entry runs
 * on Node, Deno, Bun and Workers without a CommonJS dependency.
 */
/** The three Standard Webhooks headers. @public */
interface WebhookSignatureHeaders {
  readonly 'webhook-id': string;
  readonly 'webhook-timestamp': string;
  readonly 'webhook-signature': string;
}
/** Input of `signWebhook`. @public */
interface SignWebhookInput {
  /** `whsec_<base64>` secret. Pass several during a rotation: the header carries one signature per secret. */
  readonly secret: string | readonly string[];
  /** Stable message id, reused by every retry of the same message. */
  readonly id: string;
  /** The exact body bytes that will be sent. */
  readonly body: string;
  /** Attempt time. Defaults to now. */
  readonly timestamp?: Date;
}
/**
 * Sign a message as a Standard Webhooks sender: returns the headers to send with `body`.
 * @public
 */
declare function signWebhook(input: SignWebhookInput): Promise<WebhookSignatureHeaders>;
//#endregion
export { type APIMaybePromise, type AnyHTTPResource, type BearerScopeProviderOptions, type CORSOptions, type CombineHTTPOptions, type CreateHTTPOptions, type DurableHostFailure, type DurableRunHandle, type FlowAccess, type HTTPAccess, type HTTPErrorBody, type HTTPFailureContext, type HTTPHandler, type HTTPOperation, type HTTPResourceMethod, type HTTPRunAPIOptions, type HTTPScopes, type HTTPSource, type IdempotencyClaim, type IdempotencyStore, type IdempotentResponse, type JSONSchema, type MemoryIdempotencyStoreOptions, MemoryWebhookStore, type OAuth2ScopeProviderOptions, type OpenAPIContribution, type OpenAPIDocument, type OpenAPIInfo, type OpenAPIOperation, type OpenAPITag, type OutboundWebhookEvent, type OutboundWebhookEventData, type OutboundWebhookEventInput, type OutboundWebhookEvents, type OutboundWebhookFailureContext, type ReceiverOptions, type RunCreation, type RunDataLayer, type RunHandle, type RunLookup, type ScopeAuthorizationContext, type ScopeIdentity, type ScopeProvider, type ScopeProviderDocumentation, type SignWebhookInput, type StandardWebhookEnvelope, type StepAccessFor, type VerifiedWebhookDelivery, type WebhookDelivery, type WebhookDeliveryClaim, type WebhookDeliveryOptions, type WebhookDeliveryOutcome, type WebhookDeliveryQuery, type WebhookDeliverySettlement, type WebhookDeliveryStatus, type WebhookDeliveryView, type WebhookEndpointPolicy, type WebhookEndpointPolicyContext, type WebhookEndpointValidationOptions, type WebhookEnqueueResult, type WebhookIdentifierOptions, type WebhookPublishRejected, type WebhookPublishResult, type WebhookPublished, type WebhookSecret, type WebhookSignatureContext, type WebhookSignatureHeaders, type WebhookStore, type WebhookSubscription, type WebhookSubscriptionAuthorizationContext, type WebhookSubscriptionOperation, type WebhookSubscriptionPatch, type WebhookSubscriptionQuery, type WebhookSubscriptionScopes, type WebhookSubscriptionStatus, type WebhookSubscriptionView, type WebhookSubscriptions, type WebhookSubscriptionsOptions, type WebhookWorkOptions, type WebhookWorkResult, type WizardHTTP, combineHTTP, createBearerScopeProvider, createHTTP, createMemoryIdempotencyStore, createMemoryWebhookStore, createOAuth2ScopeProvider, createWebhookSubscriptions, signWebhook, validateWebhookEndpoint };
//# sourceMappingURL=index.d.ts.map