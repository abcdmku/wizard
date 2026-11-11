import type {
  OpenAPIContribution,
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIOperation,
} from './openapi-types'

/** HTTP methods used by generated OpenWizard routes. @public */
export type HTTPResourceMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST'

/**
 * One generated route: a framework-neutral handler plus its OpenAPI operation.
 * `path` uses `:name` parameters; the OpenAPI path is derived from it. A route without
 * `openAPI` is served but left out of the document (the Mirror wire POST).
 * @public
 */
export interface AnyHTTPResource {
  readonly id: string
  readonly method: HTTPResourceMethod
  readonly path: string
  readonly openAPI?: OpenAPIOperation
  handle(request: Request): Promise<Response>
}

/**
 * Routes plus the OpenAPI components they reference: what `createHTTP` and
 * `createWebhookSubscriptions` return, and what `combineHTTP` composes.
 * @public
 */
export interface HTTPSource {
  readonly resources: readonly AnyHTTPResource[]
  readonly openAPIComponents: OpenAPIContribution
}

/**
 * A servable set of routes. `fetch` routes a request (JSON 404/405 otherwise, OPTIONS answered
 * for CORS preflight); `openAPI` returns the OpenAPI 3.1 document of every documented route.
 * @public
 */
export interface HTTPHandler extends HTTPSource {
  fetch(request: Request): Promise<Response>
  openAPI(info: OpenAPIInfo): OpenAPIDocument
}

/**
 * The error body of every generated route. `code` is stable; `message` is for humans;
 * `issues` lists validation problems; `requiredScopes` names the scopes a 403 needed.
 * @public
 */
export interface HTTPErrorBody {
  readonly ok: false
  readonly code: string
  readonly message: string
  readonly issues?: readonly { readonly message: string; readonly path?: readonly unknown[] }[]
  readonly requiredScopes?: readonly string[]
}
