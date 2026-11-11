import { failure } from './http-response'

/** A value or promise-like value returned by an HTTP callback. @public */
export type APIMaybePromise<T> = T | PromiseLike<T>

/** An authenticated tenant, caller, and the exact scopes granted to it. @public */
export interface ScopeIdentity<P> {
  readonly tenantId: string
  readonly principal: P
  readonly scopes: readonly string[]
}

/** The generated API operation a request targets. @public */
export type HTTPOperation = 'command' | 'create' | 'event' | 'read' | 'stream'

/** Request context passed to a scope provider's authorization policy. @public */
export interface ScopeAuthorizationContext<P> {
  readonly request: Request
  readonly identity: ScopeIdentity<P>
  readonly requiredScopes: readonly string[]
  readonly operation: HTTPOperation
  /** Absent for `create`. */
  readonly runId?: string
}

/** OpenAPI and HTTP challenge metadata for a scope provider. @public */
export interface ScopeProviderDocumentation {
  readonly schemeName: string
  readonly securityScheme: Readonly<Record<string, unknown>>
  readonly challenge?: string
}

/** Pluggable authentication and scope authorization for generated routes. @public */
export interface ScopeProvider<P> {
  /** Authenticate the request. Return `null` for a missing, expired, or invalid credential. */
  authenticate(request: Request): APIMaybePromise<ScopeIdentity<P> | null>
  /** Defaults to requiring every scope in `requiredScopes` by exact string match. */
  authorize?(context: ScopeAuthorizationContext<P>): APIMaybePromise<boolean>
  readonly documentation: ScopeProviderDocumentation
}

/**
 * Authenticate and authorize one request. Returns the identity, or the 401/403 response.
 * Provider exceptions propagate so the caller reports them as a 500.
 */
export async function authorizeRequest<P>(
  provider: ScopeProvider<P>,
  request: Request,
  requiredScopes: readonly string[],
  authorize: (identity: ScopeIdentity<P>) => APIMaybePromise<boolean> = (identity) =>
    requiredScopes.every((scope) => identity.scopes.includes(scope)),
): Promise<ScopeIdentity<P> | Response> {
  const identity = await provider.authenticate(request)
  if (!validIdentity(identity)) {
    return failure(
      401,
      'UNAUTHENTICATED',
      'authentication failed',
      {},
      {
        'www-authenticate': provider.documentation.challenge ?? 'Bearer',
      },
    )
  }
  if (await authorize(identity)) return identity
  return failure(403, 'INSUFFICIENT_SCOPE', 'the caller lacks a required scope', { requiredScopes })
}

/** Scopes as documented in an OpenAPI security requirement (only OAuth-style schemes list them). */
export function securityRequirement(
  provider: Pick<ScopeProvider<unknown>, 'documentation'>,
  requiredScopes: readonly string[],
): readonly { readonly [scheme: string]: readonly string[] }[] {
  const type = provider.documentation.securityScheme.type
  const listed = type === 'oauth2' || type === 'openIdConnect' ? requiredScopes : []
  return [{ [provider.documentation.schemeName]: listed }]
}

/** The provider's security scheme with generated scope descriptions merged into OAuth flows. */
export function securityScheme(
  provider: Pick<ScopeProvider<unknown>, 'documentation'>,
  scopes: { readonly [scope: string]: string },
): Readonly<Record<string, unknown>> {
  const scheme = provider.documentation.securityScheme
  const flows = scheme.flows
  if (scheme.type !== 'oauth2' || typeof flows !== 'object' || flows === null) return scheme
  return {
    ...scheme,
    flows: Object.fromEntries(
      Object.entries(flows).map(([name, flow]) => {
        if (typeof flow !== 'object' || flow === null) return [name, flow]
        const declared = 'scopes' in flow && typeof flow.scopes === 'object' ? flow.scopes : {}
        return [name, { ...flow, scopes: { ...scopes, ...declared } }]
      }),
    ),
  }
}

export function validateProvider(provider: Pick<ScopeProvider<unknown>, 'documentation'>): void {
  const documentation = provider.documentation
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(documentation.schemeName)) {
    throw new TypeError('scope-provider scheme name must be an OpenAPI component name')
  }
  if (typeof documentation.securityScheme?.type !== 'string') {
    throw new TypeError('scope-provider securityScheme must declare its OpenAPI type')
  }
}

export function validateScopes(scopes: readonly string[], label: string): readonly string[] {
  if (scopes.some((scope) => typeof scope !== 'string' || scope.length === 0)) {
    throw new TypeError(`${label} must be non-empty strings`)
  }
  return scopes
}

function validIdentity<P>(identity: ScopeIdentity<P> | null): identity is ScopeIdentity<P> {
  return (
    identity !== null &&
    typeof identity === 'object' &&
    typeof identity.tenantId === 'string' &&
    identity.tenantId.length > 0 &&
    Object.hasOwn(identity, 'principal') &&
    Array.isArray(identity.scopes) &&
    identity.scopes.every((scope) => typeof scope === 'string' && scope.length > 0)
  )
}
