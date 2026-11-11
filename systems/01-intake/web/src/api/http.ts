import type { ZodError, ZodType } from 'zod'

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export interface JsonRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  body?: unknown
  method?: HttpMethod
}

export type HttpRequestOptions = Omit<JsonRequestOptions, 'body' | 'method'>

export interface HttpClientOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
}

export interface HttpClient {
  request<T>(path: string, schema: ZodType<T>, options?: JsonRequestOptions): Promise<T>
  get<T>(path: string, schema: ZodType<T>, options?: HttpRequestOptions): Promise<T>
  post<T>(path: string, body: unknown, schema: ZodType<T>, options?: HttpRequestOptions): Promise<T>
  patch<T>(
    path: string,
    body: unknown,
    schema: ZodType<T>,
    options?: HttpRequestOptions,
  ): Promise<T>
  delete<T>(path: string, schema: ZodType<T>, options?: HttpRequestOptions): Promise<T>
}

interface HttpErrorDetails {
  body: unknown
  method: HttpMethod
  status: number
  statusText: string
  url: string
}

export class HttpError extends Error {
  readonly body: unknown
  readonly method: HttpMethod
  readonly status: number
  readonly statusText: string
  readonly url: string

  constructor(details: HttpErrorDetails) {
    super(
      `${details.method} ${details.url} failed with ${details.status} ${details.statusText}`.trim(),
    )
    this.name = 'HttpError'
    this.body = details.body
    this.method = details.method
    this.status = details.status
    this.statusText = details.statusText
    this.url = details.url
  }
}

export class ResponseValidationError extends Error {
  readonly body: unknown
  readonly issues: ZodError['issues']
  readonly url: string

  constructor(url: string, body: unknown, error: ZodError) {
    super(`The response from ${url} did not match its schema`, { cause: error })
    this.name = 'ResponseValidationError'
    this.body = body
    this.issues = error.issues
    this.url = url
  }
}

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
export const DEMO_TENANT_ID = 'demo-grants'

export const APPLICANT_API_HEADERS: Readonly<Record<string, string>> = {
  Authorization: 'Bearer intake-applicant-demo',
  'X-Tenant-Id': DEMO_TENANT_ID,
}

export const REVIEWER_API_HEADERS: Readonly<Record<string, string>> = {
  Authorization: 'Bearer intake-reviewer-demo',
  'X-Tenant-Id': DEMO_TENANT_ID,
}

const absoluteUrlPattern = /^[a-z][a-z\d+.-]*:/i

export function resolveApiUrl(path: string, baseUrl = API_BASE_URL): string {
  if (absoluteUrlPattern.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl.trim().replace(/\/+$/, '')}${normalizedPath}`
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return undefined

  try {
    const body: unknown = JSON.parse(text)
    return body
  } catch {
    return text
  }
}

function mergeHeaders(
  defaults: HeadersInit | undefined,
  overrides: HeadersInit | undefined,
): Headers {
  const headers = new Headers(defaults)
  new Headers(overrides).forEach((value, key) => {
    headers.set(key, value)
  })
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  return headers
}

export function createHttpClient(clientOptions: HttpClientOptions = {}): HttpClient {
  const baseUrl = clientOptions.baseUrl ?? API_BASE_URL

  async function request<T>(
    path: string,
    schema: ZodType<T>,
    options: JsonRequestOptions = {},
  ): Promise<T> {
    const { body, headers: headerOverrides, method = 'GET', ...requestOptions } = options
    const headers = mergeHeaders(clientOptions.headers, headerOverrides)
    const url = resolveApiUrl(path, baseUrl)
    const init: RequestInit = {
      credentials: 'same-origin',
      ...requestOptions,
      headers,
      method,
    }

    if (body !== undefined) {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      init.body = JSON.stringify(body)
    }

    const send = clientOptions.fetch ?? globalThis.fetch
    const response = await send(url, init)
    const responseBody = await readBody(response)

    if (!response.ok) {
      throw new HttpError({
        body: responseBody,
        method,
        status: response.status,
        statusText: response.statusText,
        url,
      })
    }

    const parsed = schema.safeParse(responseBody)
    if (!parsed.success) throw new ResponseValidationError(url, responseBody, parsed.error)
    return parsed.data
  }

  return {
    request,
    get: (path, schema, options) => request(path, schema, { ...options, method: 'GET' }),
    post: (path, body, schema, options) =>
      request(path, schema, { ...options, body, method: 'POST' }),
    patch: (path, body, schema, options) =>
      request(path, schema, { ...options, body, method: 'PATCH' }),
    delete: (path, schema, options) => request(path, schema, { ...options, method: 'DELETE' }),
  }
}
