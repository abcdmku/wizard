import { type CORSOptions, preflight, withCORS } from './cors'
import type { AnyHTTPResource, HTTPSource } from './http'
import { decodeSegment, failure, methodNotAllowed } from './http-response'

/** Path parameters of `pattern` (`/api/:runId`) in `pathname`, or `undefined` when it does not match. */
function matchPath(
  pattern: string,
  pathname: string,
): { readonly [name: string]: string } | undefined {
  const expected = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (expected.length !== actual.length) return undefined
  const parameters: Record<string, string> = {}
  for (let index = 0; index < expected.length; index++) {
    const part = expected[index] as string
    const value = actual[index] as string
    if (part.startsWith(':')) {
      const decoded = decodeSegment(value)
      if (decoded === undefined) return undefined
      parameters[part.slice(1)] = decoded
    } else if (part !== value) return undefined
  }
  return parameters
}

/** The path parameters of `request` for `resource`, or `undefined`. */
export function parametersOf(
  resource: Pick<AnyHTTPResource, 'path'>,
  request: Request,
): { readonly [name: string]: string } | undefined {
  try {
    return matchPath(resource.path, new URL(request.url).pathname)
  } catch {
    return undefined
  }
}

/**
 * One `fetch`-style handler for `resources`: dispatches on method and path, answers unknown
 * paths with a JSON 404, known paths with a JSON 405 listing `Allow`, and `OPTIONS` with the
 * allowed methods (plus the CORS preflight grant when `cors` allows the origin).
 */
export function createFetchHandler(
  resources: readonly AnyHTTPResource[],
  cors: CORSOptions | undefined,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let pathname: string
    try {
      pathname = new URL(request.url).pathname
    } catch {
      return failure(400, 'INVALID_URL', 'the request URL is invalid')
    }
    const matches = resources.filter((resource) => matchPath(resource.path, pathname) !== undefined)
    if (matches.length === 0) {
      return withCORS(cors, request, failure(404, 'NOT_FOUND', 'no route matches this path'))
    }
    const allowed = [...new Set(matches.map((candidate) => candidate.method))]
    const method = request.method.toUpperCase()
    if (method === 'OPTIONS') return preflight(cors, request, allowed)
    // When custom paths overlap, a literal segment beats a parameter.
    const resource = matches
      .filter((candidate) => candidate.method === method)
      .sort((left, right) => literalSegments(right.path) - literalSegments(left.path))[0]
    const response =
      resource === undefined ? methodNotAllowed(allowed) : await resource.handle(request)
    return withCORS(cors, request, response)
  }
}

function literalSegments(path: string): number {
  return path.split('/').filter((part) => part.length > 0 && !part.startsWith(':')).length
}

/** Every resource of `sources`, checked for duplicate ids and routes. */
export function collectResources(sources: readonly HTTPSource[]): readonly AnyHTTPResource[] {
  const ids = new Set<string>()
  const routes = new Set<string>()
  const resources = sources.flatMap((source) => source.resources)
  for (const resource of resources) {
    const route = `${resource.method} ${resource.path.replace(/:[^/]+/g, ':')}`
    if (ids.has(resource.id)) throw new TypeError(`duplicate HTTP resource id '${resource.id}'`)
    if (routes.has(route)) {
      throw new TypeError(`duplicate HTTP route '${resource.method} ${resource.path}'`)
    }
    ids.add(resource.id)
    routes.add(route)
  }
  return resources
}
