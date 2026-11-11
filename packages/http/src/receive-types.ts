import type { AnyWizard, EventType } from '@openwizard/core'
import type { APIMaybePromise } from './auth'
import type { RunHandle } from './run-handle'

/** The signed JSON envelope a receiver accepts. @public */
export interface StandardWebhookEnvelope<E extends string = string, D = unknown> {
  /** Dot-delimited event type. It must match the receiver's declared event. */
  readonly type: E
  /** ISO 8601 time at which the producer created the event. */
  readonly timestamp: string
  /** Event payload. The wizard's event boundary parses it before a handler sees it. */
  readonly data: D
  /** Optional run key, also the default correlation id. */
  readonly subject?: string
}

/** Unverified signature headers available while selecting the signing secret. @public */
export interface WebhookSignatureContext {
  readonly request: Request
  readonly event: string
  readonly webhookId: string | null
  readonly webhookTimestamp: string | null
  readonly webhookSignature: string | null
}

/**
 * `whsec_` secret(s) of a receiver: one, several during a rotation (any one may sign), or a
 * selector per request (per event or per tenant).
 * @public
 */
export type WebhookSecret =
  | string
  | readonly string[]
  | ((context: WebhookSignatureContext) => APIMaybePromise<string | readonly string[]>)

/** A verified delivery passed to run resolution and correlation callbacks. @public */
export interface VerifiedWebhookDelivery<E extends string = string> {
  readonly request: Request
  /** The `webhook-id` header: the message id, reused by every retry of one message. */
  readonly webhookId: string
  /** Delivery-attempt time from the signed `webhook-timestamp` header. */
  readonly attemptTimestamp: Date
  /** The verified envelope. `data` stays untrusted until the wizard's event boundary parses it. */
  readonly envelope: StandardWebhookEnvelope<E, unknown>
}

/**
 * Signed Standard Webhooks receivers: one `POST <path>/<event>` route per listed event. The
 * `webhook-id` is the event id, so a redelivered message is accepted once.
 * @public
 */
export interface ReceiverOptions<F extends AnyWizard> {
  /** The events senders may deliver. Nothing is received unless it is listed. */
  readonly events: readonly EventType<F>[]
  readonly secret: WebhookSecret
  /** Find the run (or durable host) a verified delivery is for. Enforce tenancy here. */
  readonly resolve: (
    delivery: VerifiedWebhookDelivery<EventType<F>>,
  ) => APIMaybePromise<RunHandle<F> | null | undefined>
  /** The correlation id sent with the event. Defaults to the envelope `subject`. */
  readonly correlationId?: (
    delivery: VerifiedWebhookDelivery<EventType<F>>,
  ) => APIMaybePromise<string | undefined>
  /** Route prefix. Defaults to `/webhooks/<id>`. */
  readonly path?: string
  /** Accepted distance between `webhook-timestamp` and now. Defaults to 300 seconds. */
  readonly toleranceSeconds?: number
  /** Maximum body size. Defaults to 1 MiB. */
  readonly maxBodyBytes?: number
}
