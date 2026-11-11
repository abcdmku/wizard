/**
 * Cross-origin access for browser clients (a Mirror over `httpTransport`, a SPA calling the run
 * routes from another origin).
 * @public
 */
export interface CORSOptions {
  /** Origins allowed to call the routes (`https://app.example.com`), or `'*'` for any origin. */
  readonly origins: '*' | readonly string[]
  /** Send `Access-Control-Allow-Credentials: true` (cookies). Requires an explicit origin list. */
  readonly credentials?: boolean
  /** How long a browser may cache a preflight answer. Defaults to 600 seconds. */
  readonly maxAgeSeconds?: number
}

const ALLOW_HEADERS = 'authorization, content-type, idempotency-key, last-event-id'
const EXPOSE_HEADERS = 'idempotent-replayed, retry-after'

export function validateCORS(cors: CORSOptions | undefined): void {
  if (cors === undefined) return
  const { origins, credentials, maxAgeSeconds } = cors
  if (origins !== '*') {
    if (!Array.isArray(origins) || origins.length === 0) {
      throw new TypeError("cors.origins must be '*' or a non-empty list of origins")
    }
    for (const origin of origins) {
      if (typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin)) {
        throw new TypeError(`cors.origins entry '${String(origin)}' must be a scheme://host origin`)
      }
    }
  }
  if (credentials === true && origins === '*') {
    throw new TypeError("cors.credentials requires an explicit origin list, not '*'")
  }
  if (maxAgeSeconds !== undefined && (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0)) {
    throw new TypeError('cors.maxAgeSeconds must be a non-negative safe integer')
  }
}

/** The CORS headers every response to an allowed origin carries, or `undefined`. */
function originHeaders(
  cors: CORSOptions | undefined,
  request: Request,
): Record<string, string> | undefined {
  const origin = request.headers.get('origin')
  if (cors === undefined || origin === null) return undefined
  if (cors.origins === '*') return { 'access-control-allow-origin': '*' }
  if (!cors.origins.includes(origin)) return undefined
  return {
    'access-control-allow-origin': origin,
    vary: 'origin',
    ...(cors.credentials === true ? { 'access-control-allow-credentials': 'true' } : {}),
  }
}

/** The answer to `OPTIONS` on a known route: `Allow`, plus the preflight grant for an allowed origin. */
export function preflight(
  cors: CORSOptions | undefined,
  request: Request,
  methods: readonly string[],
): Response {
  const allow = [...methods, 'OPTIONS'].join(', ')
  const granted = originHeaders(cors, request)
  return new Response(null, {
    status: 204,
    headers: {
      allow,
      ...(granted === undefined
        ? {}
        : {
            ...granted,
            'access-control-allow-methods': allow,
            'access-control-allow-headers': ALLOW_HEADERS,
            'access-control-max-age': String(cors?.maxAgeSeconds ?? 600),
          }),
    },
  })
}

/** `response` with the CORS headers an allowed origin needs to read it. */
export function withCORS(
  cors: CORSOptions | undefined,
  request: Request,
  response: Response,
): Response {
  const granted = originHeaders(cors, request)
  if (granted === undefined) return response
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(granted)) headers.set(name, value)
  headers.set('access-control-expose-headers', EXPOSE_HEADERS)
  return new Response(response.body, { status: response.status, headers })
}
