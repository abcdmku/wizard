import type {
  AnyWizard,
  ChildStepId,
  ContextInput,
  Ctx,
  EventType,
  Projection,
  ProjectionDefinition,
  RunStepId,
  StepId,
  ViewId,
} from '@openwizard/core'
import type { APIMaybePromise, HTTPOperation, ScopeProvider } from './auth'
import type { CORSOptions } from './cors'
import type { HTTPHandler } from './http'
import type { IdempotencyStore } from './idempotency'
import type { ReceiverOptions } from './receive-types'
import type { RunHandle } from './run-handle'

/** Flow capabilities an API can expose. `create` adds `POST <base>`; the reads add `GET <base>/:runId` and its stream. @public */
export type FlowAccess =
  | 'back'
  | 'cancel'
  | 'compensate'
  | 'create'
  | 'next'
  | 'output'
  | 'progress'
  | 'read'
  | 'reset'
  | 'startReady'
  | 'start'

/** Capabilities available on a specific step, narrowed by kind and capabilities. @public */
export type StepAccessFor<F extends AnyWizard, K extends StepId<F>> =
  | 'error'
  | 'invalidate'
  | 'issues'
  | 'output'
  | 'read'
  | 'skip'
  | (K extends ViewId<F> ? 'go' | 'input' | 'resetInput' | 'setInput' : never)
  | (K extends RunStepId<F> ? 'retry' | 'startStep' : never)
  | (K extends ChildStepId<F> ? 'child' | 'summary' : never)

/** What the API exposes. Nothing is exposed unless it is listed here. @public */
export interface HTTPAccess<F extends AnyWizard> {
  /** Context keys returned by the run routes. */
  readonly context?: readonly (keyof Ctx<F> & string)[]
  readonly flow?: readonly FlowAccess[]
  readonly steps?: { readonly [K in StepId<F>]?: readonly StepAccessFor<F, K>[] }
  /** Declared events that callers may send through `POST <base>/:runId/events/<event>`. */
  readonly events?: readonly EventType<F>[]
}

/** Scope overrides. Defaults: `<id>:read`, `<id>:create`, `<id>:command`. @public */
export interface HTTPScopes {
  readonly read?: readonly string[]
  readonly create?: readonly string[]
  /** Commands and event sends. */
  readonly command?: readonly string[]
}

/** Authenticated lookup of one run. @public */
export interface RunLookup<P> {
  readonly request: Request
  readonly tenantId: string
  readonly principal: P
  readonly runId: string
}

/** Authenticated creation of one run; `input` passed the flow's context boundary. @public */
export interface RunCreation<F extends AnyWizard, P> {
  readonly request: Request
  readonly tenantId: string
  readonly principal: P
  readonly input: ContextInput<F>
  /** The request's `Idempotency-Key`, a natural run id for retried creates. */
  readonly idempotencyKey?: string
}

/** Tenant-scoped run storage behind the generated API. @public */
export interface RunDataLayer<F extends AnyWizard, P> {
  /** The one live owner of the run (a `Run`, or a durable host that owns it). */
  get(lookup: RunLookup<P>): APIMaybePromise<RunHandle<F> | null | undefined>
  /** Create (and usually start) a run. Required by the `create` capability. */
  create?(creation: RunCreation<F, P>): APIMaybePromise<RunHandle<F>>
}

/** Where an unexpected failure happened, as reported to `onError`. @public */
export interface HTTPFailureContext {
  readonly request: Request
  readonly operation: HTTPOperation | 'receive'
  readonly runId?: string
  readonly event?: string
  readonly webhookId?: string
}

/**
 * The run API of `createHTTP`: `runs`, `auth` and `access` turn it on together. Access is
 * deny-by-default: only the listed capabilities become routes.
 * @public
 */
export interface HTTPRunAPIOptions<F extends AnyWizard, S, P> {
  /** Finds (and, with the `create` capability, creates) the tenant's runs. */
  readonly runs: RunDataLayer<F, P>
  readonly auth: ScopeProvider<P>
  readonly access: HTTPAccess<F>
  /** Replaces the projection derived from `access` for the run routes and stream. */
  readonly projection?: Projection<F, S> | Projection<ProjectionDefinition<F>, S>
  /** Route prefix. Defaults to `/api/<id>`. */
  readonly path?: string
  readonly scopes?: HTTPScopes
  /** Maximum JSON body size. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number
}

type WithoutRunAPI = {
  readonly [K in keyof HTTPRunAPIOptions<AnyWizard, unknown, unknown>]?: never
}

/** Options of `createHTTP`: the run API, signed receivers, or both. @public */
export type CreateHTTPOptions<F extends AnyWizard, S, P> = (
  | HTTPRunAPIOptions<F, S, P>
  | WithoutRunAPI
) & {
  /** Namespace for paths, scopes, schema names and operation ids. Defaults to the flow name. */
  readonly id?: string
  /** Signed Standard Webhooks receivers for the flow's events. */
  readonly receive?: ReceiverOptions<F>
  /**
   * Replays the response of a repeated `Idempotency-Key` or `webhook-id`. Defaults to an
   * in-process store; share one across processes (or return durable hosts from `runs`) when
   * several processes serve the same routes.
   */
  readonly idempotency?: IdempotencyStore
  /** Cross-origin access for browser clients. Off by default. */
  readonly cors?: CORSOptions
  /** Observes unexpected failures; the caller still gets a stable 500. */
  readonly onError?: (error: unknown, context: HTTPFailureContext) => APIMaybePromise<void>
}

/** Generated routes and documentation for one flow. @public */
export interface WizardHTTP<F extends AnyWizard = AnyWizard> extends HTTPHandler {
  readonly id: string
  readonly wizard: F
}
