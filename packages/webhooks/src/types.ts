import type { AnyFlow, EventType, FlowRun } from '@openwizard/core'
import type { AnyHTTPResource } from './http'

/** A value or a promise-like value returned by a webhook adapter callback. @public */
export type WebhookMaybePromise<T> = T | PromiseLike<T>

/** The signed JSON envelope accepted by an OpenWizard webhook resource. @public */
export interface StandardWebhookEnvelope<E extends string = string, D = unknown> {
  /** Dot-delimited event type. It must match the resource's declared OpenWizard event. */
  readonly type: E
  /** ISO 8601 time at which the producer created the event. */
  readonly timestamp: string
  /** Event payload. The flow's event boundary parses this value before a handler sees it. */
  readonly data: D
  /** Optional run key, also used as the default OpenWizard correlation id. */
  readonly subject?: string
}

/** Untrusted signature headers available while selecting a signing secret. @public */
export interface WebhookSignatureContext {
  readonly request: Request
  readonly webhookId: string | null
  readonly webhookTimestamp: string | null
  readonly webhookSignature: string | null
}

/** A Standard Webhooks secret or a callback that selects one for a request. @public */
export type WebhookSecret =
  | string
  | ((context: WebhookSignatureContext) => WebhookMaybePromise<string>)

/** A verified delivery passed to run resolution and correlation callbacks. @public */
export interface VerifiedWebhookDelivery<E extends string = string> {
  readonly request: Request
  readonly webhookId: string
  /** Delivery-attempt time from the signed `webhook-timestamp` header. */
  readonly attemptTimestamp: Date
  /** The verified envelope. `data` remains untrusted until `FlowRun.send` parses it. */
  readonly envelope: StandardWebhookEnvelope<E, unknown>
}

/** Atomic message-id claims used to suppress duplicate webhook delivery. @public */
export interface WebhookIdempotencyStore {
  /** Return `true` for the first claimant and `false` for a duplicate delivery. */
  claim(webhookId: string): WebhookMaybePromise<boolean>
  /** Release a failed claim so a later provider retry can attempt delivery again. */
  release(webhookId: string): WebhookMaybePromise<void>
}

/** JSON Schema fragment embedded in generated OpenAPI request documentation. @public */
export type WebhookDataSchema = Readonly<Record<string, unknown>>

/** Documentation overrides for one generated webhook endpoint. @public */
export interface WebhookDocumentation {
  readonly summary?: string
  readonly description?: string
  readonly operationId?: string
  readonly tags?: readonly string[]
  /** Schema for the envelope's `data` property. The envelope itself is generated. */
  readonly dataSchema?: WebhookDataSchema
  readonly dataExample?: unknown
}

/** OpenAPI operation generated from a webhook resource declaration. @public */
export interface WebhookOpenAPIOperation {
  readonly tags: readonly string[]
  readonly summary: string
  readonly description: string
  readonly operationId: string
  readonly parameters: readonly Readonly<Record<string, unknown>>[]
  readonly requestBody: Readonly<Record<string, unknown>>
  readonly responses: Readonly<Record<string, unknown>>
  readonly 'x-standard-webhooks': '1.0.0'
}

/** Context reported for an unexpected receiver failure. @public */
export interface WebhookFailureContext {
  readonly request: Request
  readonly webhookId?: string
  readonly event: string
}

/** Options for one signed HTTP endpoint mapped to an OpenWizard event. @public */
export interface WebhookResourceOptions<F extends AnyFlow, E extends EventType<F>> {
  readonly flow: F
  readonly event: E
  readonly secret: WebhookSecret
  /** Stable resource id. Defaults to the event name. */
  readonly id?: string
  /** Absolute HTTP path. Defaults to `/webhooks/<event>`. */
  readonly path?: string
  /** Find the live or resumed run that should receive this verified delivery. */
  readonly resolveRun: (
    delivery: VerifiedWebhookDelivery<E>,
  ) => WebhookMaybePromise<FlowRun<F> | null | undefined>
  /** Select the inbound correlation id. Defaults to `envelope.subject`. */
  readonly correlationId?: (
    delivery: VerifiedWebhookDelivery<E>,
  ) => WebhookMaybePromise<string | undefined>
  readonly idempotency?: WebhookIdempotencyStore
  /** Maximum UTF-8 request size. Defaults to 1 MiB. */
  readonly maxBodyBytes?: number
  readonly documentation?: WebhookDocumentation
  /** Observe unexpected secret, store, resolver, or run failures without exposing them to callers. */
  readonly onError?: (error: unknown, context: WebhookFailureContext) => WebhookMaybePromise<void>
}

/** Framework-neutral metadata and request handler for one webhook endpoint. @public */
export interface AnyWebhookResource extends AnyHTTPResource {
  readonly id: string
  readonly event: string
  readonly path: string
  readonly method: 'POST'
  readonly openAPI: WebhookOpenAPIOperation
  handle(request: Request): Promise<Response>
}

/** A webhook resource whose event and run are typed by its OpenWizard flow. @public */
export interface WebhookResource<F extends AnyFlow, E extends EventType<F>>
  extends AnyWebhookResource {
  readonly flow: F
  readonly event: E
}
