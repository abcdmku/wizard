import { decodeServerSentEvents, type ServerSentEvent } from '@openwizard/http/client'
import type { ZodError, ZodType } from 'zod'
import type { ApplicationStreamEvent } from '../../../shared/sse'
import { ApplicationStreamEventSchema } from '../../../shared/sse'
import { API_BASE_URL, APPLICANT_API_HEADERS, resolveApiUrl } from './http'

export type EventStreamStatus = 'closed' | 'connecting' | 'open' | 'reconnecting'

export interface TypedServerEvent<T> {
  data: T
  event: string
  id?: string
}

export interface EventStreamOptions<T> {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
  onError?: (error: Error) => void
  onEvent: (event: TypedServerEvent<T>) => void
  onStatusChange?: (status: EventStreamStatus) => void
  retryDelayMs?: number
  signal?: AbortSignal
}

export interface EventStreamSubscription {
  readonly status: EventStreamStatus
  close(): void
}

export class EventStreamMessageError extends Error {
  readonly data: string
  readonly issues?: ZodError['issues']

  constructor(data: string, cause: unknown, issues?: ZodError['issues']) {
    super('An event stream message did not match its schema', { cause })
    this.name = 'EventStreamMessageError'
    this.data = data
    if (issues !== undefined) this.issues = issues
  }
}

export class EventStreamHttpError extends Error {
  readonly body: string
  readonly status: number
  readonly statusText: string
  readonly url: string

  constructor(response: Response, body: string) {
    super(`Event stream ${response.url || 'request'} failed with ${response.status}`)
    this.name = 'EventStreamHttpError'
    this.body = body
    this.status = response.status
    this.statusText = response.statusText
    this.url = response.url
  }
}

function mergeEventHeaders(defaults: HeadersInit, overrides: HeadersInit | undefined): Headers {
  const headers = new Headers(defaults)
  new Headers(overrides).forEach((value, key) => {
    headers.set(key, value)
  })
  headers.set('Accept', 'text/event-stream')
  headers.set('Cache-Control', 'no-cache')
  return headers
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)

    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }

    signal.addEventListener('abort', done, { once: true })
  })
}

function decodeEvent<T>(event: ServerSentEvent, schema: ZodType<T>): TypedServerEvent<T> {
  let value: unknown
  try {
    value = JSON.parse(event.data)
  } catch (error) {
    throw new EventStreamMessageError(event.data, error)
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new EventStreamMessageError(event.data, parsed.error, parsed.error.issues)
  }

  const decoded: TypedServerEvent<T> = { data: parsed.data, event: event.event }
  if (event.id !== undefined) decoded.id = event.id
  return decoded
}

export function connectEventStream<T>(
  path: string,
  schema: ZodType<T>,
  options: EventStreamOptions<T>,
): EventStreamSubscription {
  const controller = new AbortController()
  const baseUrl = options.baseUrl ?? API_BASE_URL
  const url = resolveApiUrl(path, baseUrl)
  const send = options.fetch ?? globalThis.fetch
  const headers = mergeEventHeaders({}, options.headers)
  let closed = false
  let lastEventId: string | undefined
  let reconnecting = false
  let retryDelayMs = options.retryDelayMs ?? 1_000
  let status: EventStreamStatus = 'connecting'

  function setStatus(next: EventStreamStatus): void {
    if (status === next) return
    status = next
    options.onStatusChange?.(next)
  }

  function close(): void {
    if (closed) return
    closed = true
    controller.abort()
    options.signal?.removeEventListener('abort', close)
    setStatus('closed')
  }

  async function consume(response: Response): Promise<void> {
    const stream = response.body
    if (stream === null) throw new Error('The event stream response had no body')

    for await (const rawEvent of decodeServerSentEvents(stream, {
      signal: controller.signal,
    })) {
      if (rawEvent.id !== undefined) lastEventId = rawEvent.id
      if (rawEvent.retry !== undefined) retryDelayMs = rawEvent.retry
      try {
        options.onEvent(decodeEvent(rawEvent, schema))
      } catch (error) {
        options.onError?.(
          error instanceof Error ? error : new Error('Event handler failed', { cause: error }),
        )
      }
    }
  }

  async function run(): Promise<void> {
    while (!closed) {
      setStatus(reconnecting ? 'reconnecting' : 'connecting')
      const requestHeaders = new Headers(headers)
      if (lastEventId !== undefined) requestHeaders.set('Last-Event-ID', lastEventId)

      try {
        const response = await send(url, {
          credentials: 'same-origin',
          headers: requestHeaders,
          signal: controller.signal,
        })
        if (response.status === 204) {
          close()
          return
        }
        if (!response.ok) throw new EventStreamHttpError(response, await response.text())

        setStatus('open')
        await consume(response)
        if (!closed) options.onError?.(new Error('The event stream disconnected'))
      } catch (error) {
        if (closed || controller.signal.aborted) return
        options.onError?.(
          error instanceof Error ? error : new Error('The event stream failed', { cause: error }),
        )
      }

      reconnecting = true
      await waitForRetry(retryDelayMs, controller.signal)
    }
  }

  options.onStatusChange?.(status)
  if (options.signal?.aborted) close()
  else options.signal?.addEventListener('abort', close, { once: true })

  void run().catch((error: unknown) => {
    if (!closed) {
      options.onError?.(
        error instanceof Error ? error : new Error('The event stream failed', { cause: error }),
      )
      close()
    }
  })

  return {
    close,
    get status() {
      return status
    },
  }
}

export function subscribeToApplicationEvents(
  applicationId: string,
  options: EventStreamOptions<ApplicationStreamEvent>,
): EventStreamSubscription {
  if (applicationId.trim().length === 0) throw new TypeError('Application id cannot be empty')
  const headers = mergeEventHeaders(APPLICANT_API_HEADERS, options.headers)
  const path = `/api/applications/${encodeURIComponent(applicationId)}/events`
  return connectEventStream(path, ApplicationStreamEventSchema, { ...options, headers })
}
