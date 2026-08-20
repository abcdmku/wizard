import { $ as WebhookSubscriptionAuthorizationContext, A as OutboundWebhookMaybePromise, B as WebhookDeliverySettlement, C as WebhookSignatureContext, Ct as ScopeProviderDocumentation, D as OutboundWebhookEventInput, Dt as defineHTTPResources, E as OutboundWebhookEventData, Et as HTTPResourceOpenAPIComponents, F as WebhookDelivery, G as WebhookEnqueueResult, H as WebhookDeliveryView, I as WebhookDeliveryClaim, J as WebhookPublishResult, K as WebhookIdentifierOptions, L as WebhookDeliveryOptions, M as RunWebhookPublishInput, N as RunWebhookSubscriptions, O as OutboundWebhookEvents, P as RunWebhookSubscriptionsOptions, Q as WebhookSubscriptionAPIOptions, R as WebhookDeliveryOutcome, S as WebhookSecret, St as ScopeProvider, T as OutboundWebhookEvent, Tt as HTTPResourceMethod, U as WebhookEndpointPolicy, V as WebhookDeliveryStatus, W as WebhookEndpointPolicyContext, X as WebhookStore, Y as WebhookPublished, Z as WebhookSubscription, _ as WebhookIdempotencyStore, _t as RunAPIReadScopes, a as HTTPScopes, at as WebhookSubscriptionStatus, b as WebhookResource, bt as ScopeAuthorizationContext, c as ReceiverOptions, ct as WebhookSubscriptionsOptions, d as AnyWebhookResource, dt as APIMaybePromise, et as WebhookSubscriptionDocumentation, f as StandardWebhookEnvelope, ft as RunAPI, g as WebhookFailureContext, gt as RunAPIOptions, h as WebhookDocumentation, ht as RunAPIDocumentation, i as HTTPAccess, it as WebhookSubscriptionScopes, j as RunWebhookAttachment, k as OutboundWebhookFailureContext, l as StepAccessFor, lt as WebhookWorkOptions, m as WebhookDataSchema, mt as RunAPICommandOptions, n as FlowAccess, nt as WebhookSubscriptionPatch, o as ReceiverEventOptions, ot as WebhookSubscriptionView, p as VerifiedWebhookDelivery, pt as RunAPICommandContext, q as WebhookPublishRejected, r as HTTPAPIOptions, rt as WebhookSubscriptionQuery, s as ReceiverEvents, st as WebhookSubscriptions, t as CreateHTTPOptions, tt as WebhookSubscriptionOperation, u as WizardHTTP, ut as WebhookWorkResult, v as WebhookMaybePromise, vt as RunAPIResolveContext, w as AnyWebhookSubscriptions, wt as AnyHTTPResource, x as WebhookResourceOptions, xt as ScopeIdentity, y as WebhookOpenAPIOperation, yt as RunDataLayer, z as WebhookDeliveryQuery } from "./http-options-N-b_EYFt.js";
import { AnyFlow, EventType } from "@openwizard/core";
//#region src/api.d.ts
/**
 * Define authenticated run, step, and optional command resources for one OpenWizard flow.
 * @public
 */
declare function defineRunAPI<F extends AnyFlow, S, P>(options: RunAPIOptions<F, S, P>): RunAPI<F, S, P>;
//#endregion
//#region src/create-http.d.ts
/** Generate the opted-in HTTP routes and documentation for a flow. @public */
declare function createHTTP<F extends AnyFlow, S = unknown, P = unknown>(flow: F, options: CreateHTTPOptions<F, S, P>): WizardHTTP<F>;
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
//#region src/outbound.d.ts
/** Validate and retain Standard Schemas for versioned public webhook events. @public */
declare function defineOutboundEvents<const E extends OutboundWebhookEvents>(events: E): E;
/** Create outbound webhooks inherited from a flow's committed event stream. @public */
declare function createWebhookSubscriptions<F extends AnyFlow, P>(flow: F, options: RunWebhookSubscriptionsOptions<P>): RunWebhookSubscriptions<F, P>;
/** Create a custom public event publisher with explicit runtime schemas. @public */
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
   * OpenAPI OAuth flow definitions, such as `authorizationCode` or `clientCredentials`.
   * Set a flow's `scopes` to `inherit` to document the scopes generated by the run API.
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
//#region src/webhook.d.ts
/** Define a signed Standard Webhooks receiver for one event declared by an OpenWizard flow. @public */
declare function defineWebhook<F extends AnyFlow, E extends EventType<F>>(options: WebhookResourceOptions<F, E>): WebhookResource<F, E>;
/** Validate and retain a webhook collection for Nitro registration. @public */
declare function defineWebhooks<const R extends readonly AnyWebhookResource[]>(resources: R): R;
//#endregion
export { type APIMaybePromise, type AnyHTTPResource, type AnyWebhookResource, type AnyWebhookSubscriptions, type BearerScopeProviderOptions, type CreateHTTPOptions, type FlowAccess, type HTTPAPIOptions, type HTTPAccess, type HTTPResourceMethod, type HTTPResourceOpenAPIComponents, type HTTPScopes, MemoryWebhookStore, type OAuth2ScopeProviderOptions, type OutboundWebhookEvent, type OutboundWebhookEventData, type OutboundWebhookEventInput, type OutboundWebhookEvents, type OutboundWebhookFailureContext, type OutboundWebhookMaybePromise, type ReceiverEventOptions, type ReceiverEvents, type ReceiverOptions, type RunAPI, type RunAPICommandContext, type RunAPICommandOptions, type RunAPIDocumentation, type RunAPIOptions, type RunAPIReadScopes, type RunAPIResolveContext, type RunDataLayer, type RunWebhookAttachment, type RunWebhookPublishInput, type RunWebhookSubscriptions, type RunWebhookSubscriptionsOptions, type ScopeAuthorizationContext, type ScopeIdentity, type ScopeProvider, type ScopeProviderDocumentation, type StandardWebhookEnvelope, type StepAccessFor, type VerifiedWebhookDelivery, type WebhookDataSchema, type WebhookDelivery, type WebhookDeliveryClaim, type WebhookDeliveryOptions, type WebhookDeliveryOutcome, type WebhookDeliveryQuery, type WebhookDeliverySettlement, type WebhookDeliveryStatus, type WebhookDeliveryView, type WebhookDocumentation, type WebhookEndpointPolicy, type WebhookEndpointPolicyContext, type WebhookEndpointValidationOptions, type WebhookEnqueueResult, type WebhookFailureContext, type WebhookIdempotencyStore, type WebhookIdentifierOptions, type WebhookMaybePromise, type WebhookOpenAPIOperation, type WebhookPublishRejected, type WebhookPublishResult, type WebhookPublished, type WebhookResource, type WebhookResourceOptions, type WebhookSecret, type WebhookSignatureContext, type WebhookStore, type WebhookSubscription, type WebhookSubscriptionAPIOptions, type WebhookSubscriptionAuthorizationContext, type WebhookSubscriptionDocumentation, type WebhookSubscriptionOperation, type WebhookSubscriptionPatch, type WebhookSubscriptionQuery, type WebhookSubscriptionScopes, type WebhookSubscriptionStatus, type WebhookSubscriptionView, type WebhookSubscriptions, type WebhookSubscriptionsOptions, type WebhookWorkOptions, type WebhookWorkResult, type WizardHTTP, createBearerScopeProvider, createHTTP, createMemoryWebhookStore, createOAuth2ScopeProvider, createWebhookSubscriptions, defineHTTPResources, defineOutboundEvents, defineRunAPI, defineWebhook, defineWebhooks, validateWebhookEndpoint };
//# sourceMappingURL=index.d.ts.map