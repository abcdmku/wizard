/** HTTP methods supported by generated OpenWizard resources. @public */
export type HTTPResourceMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

/** OpenAPI components contributed by one generated HTTP resource. @public */
export interface HTTPResourceOpenAPIComponents {
  readonly securitySchemes?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/**
 * Framework-neutral HTTP resource consumed by the Nitro route and OpenAPI generator.
 * @public
 */
export interface AnyHTTPResource {
  readonly id: string
  /** Runtime route. Nitro parameters use `:name`. */
  readonly path: string
  /** OpenAPI route. Defaults to `path` with `:name` converted to `{name}`. */
  readonly openAPIPath?: string
  readonly method: HTTPResourceMethod
  readonly openAPI: object
  readonly openAPIComponents?: HTTPResourceOpenAPIComponents
  handle(request: Request): Promise<Response>
}

/** Validate and retain a mixed collection of webhook and REST resources. @public */
export function defineHTTPResources<const R extends readonly AnyHTTPResource[]>(resources: R): R {
  const ids = new Set<string>()
  const routes = new Set<string>()
  for (const resource of resources) {
    if (resource.id.length === 0) throw new TypeError('HTTP resource id must not be empty')
    requireHTTPPath(resource.path, 'HTTP resource path')
    if (resource.openAPIPath !== undefined) {
      requireHTTPPath(resource.openAPIPath, 'HTTP resource OpenAPI path')
    }
    if (ids.has(resource.id)) throw new TypeError(`duplicate HTTP resource id '${resource.id}'`)
    const route = `${resource.method} ${resource.path}`
    if (routes.has(route)) throw new TypeError(`duplicate HTTP resource route '${route}'`)
    ids.add(resource.id)
    routes.add(route)
  }
  return Object.freeze([...resources]) as unknown as R
}

function requireHTTPPath(path: string, label: string): void {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new TypeError(`${label} must be an absolute pathname without a query or hash`)
  }
}
