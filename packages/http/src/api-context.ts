import type { AnyWizard, Projection, ProjectionDefinition } from '@openwizard/core'
import type { AccessPlan } from './access'
import {
  authorizeRequest,
  type HTTPOperation,
  type ScopeIdentity,
  type ScopeProvider,
} from './auth'
import type { HTTPFailureContext, RunDataLayer } from './http-options'
import { failure } from './http-response'
import type { IdempotencyStore } from './idempotency'
import type { RunHandle } from './run-handle'

/** Settings `createHTTP` shares between the run API and the receivers. */
export interface SharedOptions {
  readonly idempotency: IdempotencyStore
  readonly onError: ((error: unknown, context: HTTPFailureContext) => unknown) | undefined
}

/** Everything a generated API handler needs, resolved once by `createRunAPI`. */
export interface APIContext<F extends AnyWizard, P> {
  readonly id: string
  readonly wizard: F
  readonly runs: RunDataLayer<F, P>
  readonly auth: ScopeProvider<P>
  readonly plan: AccessPlan<F>
  readonly projection: Projection<F, unknown> | Projection<ProjectionDefinition<F>, unknown>
  readonly basePath: string
  readonly scopes: {
    readonly read: readonly string[]
    readonly create: readonly string[]
    readonly command: readonly string[]
  }
  readonly idempotency: IdempotencyStore
  readonly maxBodyBytes: number
  readonly onError: ((error: unknown, context: HTTPFailureContext) => unknown) | undefined
}

/** Authenticate + authorize for `operation`, delegating to the provider's policy when present. */
export function authorizeFor<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  operation: HTTPOperation,
  runId?: string,
): Promise<ScopeIdentity<P> | Response> {
  const requiredScopes =
    operation === 'create'
      ? api.scopes.create
      : operation === 'read' || operation === 'stream'
        ? api.scopes.read
        : api.scopes.command
  const provider = api.auth
  return authorizeRequest(
    provider,
    request,
    requiredScopes,
    provider.authorize === undefined
      ? undefined
      : (identity) =>
          provider.authorize?.({
            request,
            identity,
            requiredScopes,
            operation,
            ...(runId === undefined ? {} : { runId }),
          }) ?? false,
  )
}

/** The tenant's run, or a 404. */
export async function findRun<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  identity: ScopeIdentity<P>,
  runId: string,
): Promise<RunHandle<F> | Response> {
  const handle = await api.runs.get({
    request,
    tenantId: identity.tenantId,
    principal: identity.principal,
    runId,
  })
  return handle === null || handle === undefined
    ? failure(404, 'NOT_FOUND', `no run '${runId}' exists for this tenant`)
    : handle
}

/** Report an unexpected failure to `onError` and answer a stable 500. */
export async function unexpected(
  onError: ((error: unknown, context: HTTPFailureContext) => unknown) | undefined,
  error: unknown,
  context: HTTPFailureContext,
): Promise<Response> {
  try {
    await onError?.(error, context)
  } catch {
    // An observer cannot replace the stable response.
  }
  return failure(500, 'INTERNAL_ERROR', 'the OpenWizard request failed')
}

/**
 * The request's `Idempotency-Key`, scoped to this API, the tenant and `target` (so one store can
 * serve several APIs and tenants), or `undefined` without a usable header.
 */
export function idempotencyKey(
  api: Pick<APIContext<AnyWizard, unknown>, 'id'>,
  request: Request,
  identity: ScopeIdentity<unknown>,
  target: string,
): { readonly raw: string; readonly scoped: string } | undefined {
  const raw = request.headers.get('idempotency-key')
  if (raw === null || raw.length === 0 || raw.length > 255) return undefined
  return { raw, scoped: `${api.id}\0${identity.tenantId}\0${target}\0${raw}` }
}
