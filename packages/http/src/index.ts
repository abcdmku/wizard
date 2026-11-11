/**
 * `@openwizard/http`: a flow's HTTP API, signed webhook receivers and outbound callbacks as
 * framework-neutral `fetch` handlers with an OpenAPI 3.1 document. The browser client lives in
 * `@openwizard/http/client`, the Nitro adapter in `@openwizard/http/nitro`.
 *
 * @packageDocumentation
 */

export type {
  APIMaybePromise,
  HTTPOperation,
  ScopeAuthorizationContext,
  ScopeIdentity,
  ScopeProvider,
  ScopeProviderDocumentation,
} from './auth'
export { type CombineHTTPOptions, combineHTTP } from './combine'
export type { CORSOptions } from './cors'
export { createHTTP } from './create-http'
export { validateWebhookEndpoint, type WebhookEndpointValidationOptions } from './endpoint'
export type {
  AnyHTTPResource,
  HTTPErrorBody,
  HTTPHandler,
  HTTPResourceMethod,
  HTTPSource,
} from './http'
export type {
  CreateHTTPOptions,
  FlowAccess,
  HTTPAccess,
  HTTPFailureContext,
  HTTPRunAPIOptions,
  HTTPScopes,
  RunCreation,
  RunDataLayer,
  RunLookup,
  StepAccessFor,
  WizardHTTP,
} from './http-options'
export {
  createMemoryIdempotencyStore,
  type IdempotencyClaim,
  type IdempotencyStore,
  type IdempotentResponse,
  type MemoryIdempotencyStoreOptions,
} from './idempotency'
export type {
  JSONSchema,
  OpenAPIContribution,
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIOperation,
  OpenAPITag,
} from './openapi-types'
export { createWebhookSubscriptions } from './outbound'
export { createMemoryWebhookStore, MemoryWebhookStore } from './outbound-store'
export type {
  OutboundWebhookEvent,
  OutboundWebhookEventData,
  OutboundWebhookEventInput,
  OutboundWebhookEvents,
  OutboundWebhookFailureContext,
  WebhookDelivery,
  WebhookDeliveryClaim,
  WebhookDeliveryOptions,
  WebhookDeliveryOutcome,
  WebhookDeliveryQuery,
  WebhookDeliverySettlement,
  WebhookDeliveryStatus,
  WebhookDeliveryView,
  WebhookEndpointPolicy,
  WebhookEndpointPolicyContext,
  WebhookEnqueueResult,
  WebhookIdentifierOptions,
  WebhookPublished,
  WebhookPublishRejected,
  WebhookPublishResult,
  WebhookStore,
  WebhookSubscription,
  WebhookSubscriptionAuthorizationContext,
  WebhookSubscriptionOperation,
  WebhookSubscriptionPatch,
  WebhookSubscriptionQuery,
  WebhookSubscriptionScopes,
  WebhookSubscriptionStatus,
  WebhookSubscriptions,
  WebhookSubscriptionsOptions,
  WebhookSubscriptionView,
  WebhookWorkOptions,
  WebhookWorkResult,
} from './outbound-types'
export type {
  ReceiverOptions,
  StandardWebhookEnvelope,
  VerifiedWebhookDelivery,
  WebhookSecret,
  WebhookSignatureContext,
} from './receive-types'
export type { DurableHostFailure, DurableRunHandle, RunHandle } from './run-handle'
export {
  type BearerScopeProviderOptions,
  createBearerScopeProvider,
  createOAuth2ScopeProvider,
  type OAuth2ScopeProviderOptions,
} from './scopes'
export { type SignWebhookInput, signWebhook, type WebhookSignatureHeaders } from './signature'
