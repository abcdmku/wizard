import { DashboardSchema, FleetRoutes } from '@openwizard/fleet-shared'
import { Schema } from 'effect'
import { fleetEnv } from './env'

export interface HttpResult {
  readonly status: number
  readonly headers: Headers
  readonly body: unknown
  readonly text: string
}

export interface RequestOptions {
  readonly method?: string
  readonly token?: string
  readonly body?: unknown
  readonly rawBody?: string
  readonly headers?: HeadersInit
  readonly signal?: AbortSignal
}

export async function request(path: string, options: RequestOptions = {}): Promise<HttpResult> {
  const headers = new Headers(options.headers)
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
  if (
    (options.body !== undefined || options.rawBody !== undefined) &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json')
  }
  const init: RequestInit = { method: options.method ?? 'GET', headers }
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  if (body !== undefined) init.body = body
  if (options.signal !== undefined) init.signal = options.signal
  const response = await fetch(new URL(path, fleetEnv.apiUrl), init)
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: parseBody(text), text }
}

export async function openStream(
  path: string,
  options: Omit<RequestOptions, 'body' | 'rawBody'> = {},
): Promise<{ readonly status: number; readonly headers: Headers; readonly chunk: string }> {
  const headers = new Headers(options.headers)
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)
  const response = await fetch(new URL(path, fleetEnv.apiUrl), {
    method: options.method ?? 'GET',
    headers,
    signal: controller.signal,
  })
  const reader = response.body?.getReader()
  if (reader === undefined) {
    clearTimeout(timeout)
    return { status: response.status, headers: response.headers, chunk: '' }
  }
  let chunk = ''
  try {
    const first = await reader.read()
    chunk = first.value === undefined ? '' : new TextDecoder().decode(first.value)
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error
  } finally {
    clearTimeout(timeout)
    controller.abort()
    await reader.cancel().catch(() => undefined)
  }
  return { status: response.status, headers: response.headers, chunk }
}

export function bearer(token: string): RequestOptions {
  return { token }
}

export function deliveryIdFrom(value: unknown, preferred: string): string {
  const candidates = parseDashboard(value).deliveries.map((delivery) => delivery.id)
  const match = candidates.find((item) => item === preferred)
  const first = candidates[0]
  if (match !== undefined) return match
  if (first !== undefined) return first
  throw new Error(`dispatch projection did not contain a delivery (preferred ${preferred})`)
}

export function deliveryIds(value: unknown): readonly string[] {
  return parseDashboard(value).deliveries.map((delivery) => delivery.id)
}

export async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await request(FleetRoutes.health)).status === 200) return
    } catch {
      // The API is still starting or restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Fleet API did not become healthy within ${timeoutMs}ms`)
}

export function parseDashboard(value: unknown) {
  return Schema.decodeUnknownSync(DashboardSchema)(value)
}

function parseBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export { FleetRoutes }
