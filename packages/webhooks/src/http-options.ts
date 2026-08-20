import type { AnyFlow, Ctx, EventType, FlowRun, Projection, StepId } from '@openwizard/core'
import type { APIMaybePromise, RunAPIDocumentation, RunDataLayer, ScopeProvider } from './api-types'
import type { AnyHTTPResource } from './http'
import type { AnyWebhookSubscriptions } from './outbound-types'
import type {
  AnyWebhookResource,
  VerifiedWebhookDelivery,
  WebhookDocumentation,
  WebhookFailureContext,
  WebhookIdempotencyStore,
  WebhookSecret,
} from './types'

/** Capabilities that can be enabled on the flow itself. @public */
export type FlowAccess =
  | 'back'
  | 'cancel'
  | 'compensate'
  | 'next'
  | 'output'
  | 'progress'
  | 'read'
  | 'reset'
  | 'runReady'
  | 'start'

/** Capabilities available on a specific step, narrowed by its kind. @public */
export type StepAccessFor<F extends AnyFlow, K extends StepId<F>> =
  | 'error'
  | 'invalidate'
  | 'issues'
  | 'output'
  | 'read'
  | 'skip'
  | (F['steps'][K]['kind'] extends 'view' ? 'go' | 'input' | 'resetInput' | 'setInput' : never)
  | (F['steps'][K]['kind'] extends 'task' ? 'retry' | 'run' : never)
  | (F['steps'][K]['kind'] extends 'flow' ? 'child' | 'summary' : never)

/** REST access selected from the flow's declared layers. @public */
export interface HTTPAccess<F extends AnyFlow> {
  /** Context keys returned by the run endpoint. Their presence enables that endpoint. */
  readonly context?: readonly (keyof Ctx<F> & string)[]
  readonly flow?: readonly FlowAccess[]
  readonly steps?: { readonly [K in StepId<F>]?: readonly StepAccessFor<F, K>[] }
  /** Declared events that an API caller may send. */
  readonly events?: readonly EventType<F>[]
}

/** Optional scope overrides for generated REST operations. @public */
export interface HTTPScopes {
  readonly run?: readonly string[]
  readonly step?: readonly string[]
  readonly command?: readonly string[]
}

/** Authentication, tenant-scoped data, and access rules for the generated REST API. @public */
export interface HTTPAPIOptions<F extends AnyFlow, S, P> {
  readonly auth: ScopeProvider<P>
  readonly data: RunDataLayer<F>
  /** `true` enables every flow layer. Defaults to `true`. */
  readonly access?: true | HTTPAccess<F>
  /** Override the projection inferred from `access`. */
  readonly projection?: Projection<F, S>
  /** Route prefix. Defaults to `/api/<flow-name>`, or `/api/<id>` when `id` is set. */
  readonly path?: string
  readonly scopes?: HTTPScopes
  readonly maxBodyBytes?: number
  readonly docs?: RunAPIDocumentation
  readonly onError?: (
    error: unknown,
    context: {
      readonly request: Request
      readonly operation: 'command' | 'run:read' | 'step:read'
      readonly runId?: string
    },
  ) => APIMaybePromise<void>
}

/** Overrides for one generated incoming webhook receiver. @public */
export interface ReceiverEventOptions<E extends string> {
  readonly path?: string
  readonly secret?: WebhookSecret
  readonly docs?: WebhookDocumentation
  readonly correlationId?: (
    delivery: VerifiedWebhookDelivery<E>,
  ) => APIMaybePromise<string | undefined>
}

/** Global, listed, or individually configured incoming events. @public */
export type ReceiverEvents<F extends AnyFlow> =
  | true
  | readonly EventType<F>[]
  | { readonly [E in EventType<F>]?: ReceiverEventOptions<E> }

/** Signing and run lookup for generated incoming webhook receivers. @public */
export interface ReceiverOptions<F extends AnyFlow> {
  readonly secret: WebhookSecret
  readonly resolve: (
    delivery: VerifiedWebhookDelivery<EventType<F>>,
  ) => APIMaybePromise<FlowRun<F> | null | undefined>
  /** Defaults to every event declared by the flow. */
  readonly events?: ReceiverEvents<F>
  /** Route prefix. Defaults to `/webhooks`. */
  readonly path?: string
  readonly idempotency?: WebhookIdempotencyStore
  readonly maxBodyBytes?: number
  readonly onError?: (error: unknown, context: WebhookFailureContext) => APIMaybePromise<void>
}

/** Features generated from one flow. @public */
export interface CreateHTTPOptions<F extends AnyFlow, S, P> {
  /** Namespace for resource ids and default scopes. Defaults to the flow name. */
  readonly id?: string
  readonly api?: HTTPAPIOptions<F, S, P>
  readonly receive?: ReceiverOptions<F>
  /** Outbound subscription system whose management routes join this HTTP registry. */
  readonly outbound?: AnyWebhookSubscriptions
}

/** Generated HTTP registry consumed by Nitro or another framework adapter. @public */
export interface WizardHTTP<F extends AnyFlow = AnyFlow> {
  readonly id: string
  readonly flow: F
  readonly resources: readonly AnyHTTPResource[]
  readonly receivers: readonly AnyWebhookResource[]
  readonly outbound?: AnyWebhookSubscriptions
}
