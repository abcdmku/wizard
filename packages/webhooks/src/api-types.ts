import type { AnyFlow, Command, FlowRun, Projection, StepId } from '@openwizard/core'
import type { AnyHTTPResource } from './http'

/** A value or promise-like value returned by an HTTP API callback. @public */
export type APIMaybePromise<T> = T | PromiseLike<T>

/** An authenticated tenant, caller, and the exact scopes granted to it. @public */
export interface ScopeIdentity<P> {
  readonly tenantId: string
  readonly principal: P
  readonly scopes: readonly string[]
}

/** Request context passed to a scope provider's authorization policy. @public */
export interface ScopeAuthorizationContext<P> {
  readonly request: Request
  readonly identity: ScopeIdentity<P>
  readonly requiredScopes: readonly string[]
  readonly operation: 'command' | 'run:read' | 'step:read'
  readonly runId: string
}

/** OpenAPI and HTTP challenge metadata for a scope provider. @public */
export interface ScopeProviderDocumentation {
  readonly schemeName: string
  readonly securityScheme: Readonly<Record<string, unknown>>
  readonly challenge?: string
}

/** Pluggable authentication and scope authorization for generated run APIs. @public */
export interface ScopeProvider<P> {
  /** Authenticate the request. Return `null` for a missing, expired, or invalid credential. */
  authenticate(request: Request): APIMaybePromise<ScopeIdentity<P> | null>
  /** Defaults to requiring every scope in `requiredScopes` by exact string match. */
  authorize?(context: ScopeAuthorizationContext<P>): APIMaybePromise<boolean>
  readonly documentation: ScopeProviderDocumentation
}

/** Authenticated context used to find a live or resumed OpenWizard run. @public */
export interface RunAPIResolveContext<P> {
  readonly request: Request
  readonly runId: string
  readonly tenantId: string
  readonly principal: P
  readonly scopes: readonly string[]
}

/** Tenant-scoped run lookup used by the high-level generated run API. @public */
export interface RunDataLayer<F extends AnyFlow> {
  /** Return the one live owner of this run, or restore it through your application host. */
  get(tenantId: string, runId: string): APIMaybePromise<FlowRun<F> | null | undefined>
}

/** Context used by command policy and scope callbacks. @public */
export interface RunAPICommandContext<F extends AnyFlow, P> extends RunAPIResolveContext<P> {
  readonly command: Command<F>
}

/** Command endpoint configuration. No endpoint is generated when this option is absent. @public */
export interface RunAPICommandOptions<F extends AnyFlow, P> {
  /** Explicit command policy. Return `false` for commands this external API must not expose. */
  readonly allow: (
    context: RunAPICommandContext<F, P> & { readonly run: FlowRun<F> },
  ) => APIMaybePromise<boolean>
  /** Required scopes. Defaults to `<api-id>:command`. */
  readonly scopes?: readonly string[]
  /** Maximum UTF-8 request body size. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number
}

/** Scope requirements for read endpoints. @public */
export interface RunAPIReadScopes {
  /** Defaults to `<api-id>:read`. */
  readonly run?: readonly string[]
  /** Defaults to the run-read scopes. */
  readonly step?: readonly string[]
}

/** OpenAPI overrides for a generated run API. @public */
export interface RunAPIDocumentation {
  readonly tags?: readonly string[]
  readonly runSummary?: string
  readonly stepSummary?: string
  readonly commandSummary?: string
  /** Schema for the projection returned as `data` by the run endpoint. */
  readonly runSchema?: Readonly<Record<string, unknown>>
  /** Schema for `data` returned by the step endpoint. */
  readonly stepSchema?: Readonly<Record<string, unknown>>
  /** Schema for the command request body. Auto-generated APIs infer this from their layer policy. */
  readonly commandSchema?: Readonly<Record<string, unknown>>
}

/** Options for an authenticated REST API over one OpenWizard flow. @public */
export interface RunAPIOptions<F extends AnyFlow, S, P> {
  readonly flow: F
  /** Stable API id. Defaults to the flow name. */
  readonly id?: string
  /** Runtime base path. Defaults to `/api/<api-id>`. */
  readonly basePath?: string
  /** Deny-by-default client projection returned by `GET <base>/:runId`. */
  readonly projection: Projection<F, S>
  readonly scopeProvider: ScopeProvider<P>
  readonly resolveRun: (
    context: RunAPIResolveContext<P>,
  ) => APIMaybePromise<FlowRun<F> | null | undefined>
  /** Generate `GET <base>/:runId`. Defaults to `true`. */
  readonly readRun?: boolean
  /** Steps available through the step-read route. Defaults to every declared step. */
  readonly readSteps?: readonly StepId<F>[]
  /**
   * Select a step response. By default the API reads the named step from the projected
   * state's `steps` object, then falls back to status-only data.
   */
  readonly selectStep?: (
    context: RunAPIResolveContext<P> & {
      readonly run: FlowRun<F>
      readonly step: StepId<F>
      readonly projected: S
    },
  ) => APIMaybePromise<unknown>
  readonly readScopes?: RunAPIReadScopes
  readonly commands?: RunAPICommandOptions<F, P>
  readonly documentation?: RunAPIDocumentation
  readonly onError?: (
    error: unknown,
    context: {
      readonly request: Request
      readonly operation: 'command' | 'run:read' | 'step:read'
      readonly runId?: string
    },
  ) => APIMaybePromise<void>
}

/** Generated REST API and its framework-neutral HTTP resources. @public */
export interface RunAPI<F extends AnyFlow, S, P> {
  readonly id: string
  readonly flow: F
  readonly basePath: string
  readonly resources: readonly AnyHTTPResource[]
  readonly '~types': { readonly state: S; readonly principal: P } | undefined
}
