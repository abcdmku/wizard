import {
  type APIMaybePromise,
  type ScopeIdentity,
  type ScopeProvider,
  validateProvider,
} from './auth'
import { isRecord } from './json-schema'

/** Options for a scope provider that authenticates HTTP bearer tokens. @public */
export interface BearerScopeProviderOptions<P> {
  /** Verify a token and return its tenant, principal, and granted scopes. Return `null` to reject it. */
  readonly verify: (token: string, request: Request) => APIMaybePromise<ScopeIdentity<P> | null>
  /** OpenAPI security-scheme name. Defaults to `bearerAuth`. */
  readonly schemeName?: string
  /** OpenAPI bearer format, such as `JWT`. */
  readonly bearerFormat?: string
  /** Value sent in `WWW-Authenticate`. Defaults to `Bearer`. */
  readonly challenge?: string
  /** Optional policy beyond exact required-scope matching. */
  readonly authorize?: ScopeProvider<P>['authorize']
}

/** Options for bearer authentication documented as an OpenAPI OAuth 2 security scheme. @public */
export interface OAuth2ScopeProviderOptions<P> {
  /** Verify an OAuth access token and return its tenant, subject, and granted scopes. */
  readonly verify: (token: string, request: Request) => APIMaybePromise<ScopeIdentity<P> | null>
  /**
   * OpenAPI OAuth flow definitions, such as `authorizationCode` or `clientCredentials`. The
   * scopes the generated routes require are added to every flow's `scopes`.
   */
  readonly flows: Readonly<Record<string, unknown>>
  /** OpenAPI security-scheme name. Defaults to `oauth2`. */
  readonly schemeName?: string
  /** Value sent in `WWW-Authenticate`. Defaults to `Bearer`. */
  readonly challenge?: string
  /** Optional policy beyond exact required-scope matching. */
  readonly authorize?: ScopeProvider<P>['authorize']
}

/** Create a scope provider backed by the HTTP `Authorization: Bearer` header. @public */
export function createBearerScopeProvider<P>(
  options: BearerScopeProviderOptions<P>,
): ScopeProvider<P> {
  return bearerProvider(options, {
    schemeName: options.schemeName ?? 'bearerAuth',
    securityScheme: {
      type: 'http',
      scheme: 'bearer',
      ...(options.bearerFormat === undefined ? {} : { bearerFormat: options.bearerFormat }),
    },
    challenge: options.challenge ?? 'Bearer',
  })
}

/** Create an OAuth 2 scope provider whose flows and required scopes appear in OpenAPI. @public */
export function createOAuth2ScopeProvider<P>(
  options: OAuth2ScopeProviderOptions<P>,
): ScopeProvider<P> {
  if (!isRecord(options.flows)) throw new TypeError('flows must be an OpenAPI OAuth flows object')
  return bearerProvider(options, {
    schemeName: options.schemeName ?? 'oauth2',
    securityScheme: { type: 'oauth2', flows: normalizeOAuthFlows(options.flows) },
    challenge: options.challenge ?? 'Bearer',
  })
}

function bearerProvider<P>(
  options: {
    readonly verify: (token: string, request: Request) => APIMaybePromise<ScopeIdentity<P> | null>
    readonly authorize?: ScopeProvider<P>['authorize']
  },
  documentation: ScopeProvider<P>['documentation'],
): ScopeProvider<P> {
  validateProvider({ documentation })
  return Object.freeze({
    authenticate: async (request: Request) => {
      const header = request.headers.get('authorization')
      if (header === null) return null
      const match = /^Bearer[ \t]+([^ \t].*)$/i.exec(header)
      if (match?.[1] === undefined) return null
      return options.verify(match[1], request)
    },
    ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
    documentation,
  })
}

function normalizeOAuthFlows(
  flows: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(flows).map(([name, value]) => {
      if (!isRecord(value)) return [name, value]
      return [
        name,
        {
          ...value,
          scopes: value.scopes ?? {},
        },
      ]
    }),
  )
}
