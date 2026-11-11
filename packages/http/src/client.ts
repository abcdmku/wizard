/**
 * `@openwizard/http/client`: the browser half of the generated stream route. `httpTransport`
 * connects `createMirror` to `<base>/<runId>/stream`, giving a typed client without code
 * generation; `decodeServerSentEvents` is the bounded SSE decoder it reads frames with.
 *
 * @packageDocumentation
 */

import type { Frame, Transport, WireAck } from '@openwizard/core/mirror'
import { decodeServerSentEvents } from './sse'

export { decodeServerSentEvents, type ServerSentEvent, ServerSentEventSizeError } from './sse'

/** Options of `httpTransport`. @public */
export interface HTTPTransportOptions {
  /** The fetch to call. Defaults to `globalThis.fetch`; pass `http.fetch` to test in-process. */
  readonly fetch?: (request: Request) => Promise<Response>
  /** Headers of every request, such as `authorization`. A function is called per request. */
  readonly headers?: HeadersInit | (() => HeadersInit | PromiseLike<HeadersInit>)
}

/**
 * A Mirror `Transport` over a run's generated stream route (`<base>/<runId>/stream`):
 * `subscribe` reads its server-sent frames (and reports `onClose` when the server ends the
 * stream or the connection drops), `send` POSTs a `WireCommand` and resolves with its `WireAck`.
 * Type it through the Mirror: `createMirror<typeof projection>({ transport: httpTransport(url) })`.
 * @public
 */
export function httpTransport<S>(
  url: string | URL,
  options: HTTPTransportOptions = {},
): Transport<S> {
  const fetcher = options.fetch ?? ((request: Request) => globalThis.fetch(request))
  const request = async (init: RequestInit & { readonly accept: string }) => {
    const headers = new Headers(
      typeof options.headers === 'function' ? await options.headers() : options.headers,
    )
    headers.set('accept', init.accept)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    return fetcher(new Request(url, { ...init, headers }))
  }
  return {
    subscribe(onFrame, onClose) {
      const controller = new AbortController()
      const { signal } = controller
      const read = async (): Promise<unknown> => {
        const response = await request({ accept: 'text/event-stream', signal })
        if (!response.ok || response.body === null) {
          await response.body?.cancel()
          return new Error(`the frame stream answered HTTP ${response.status}`)
        }
        for await (const event of decodeServerSentEvents(response.body, { signal })) {
          const frame = event.event === 'frame' ? parseJSON<S>(event.data) : undefined
          if (frame !== undefined) onFrame(frame)
        }
        return undefined
      }
      read().then(
        (failure) => {
          if (!signal.aborted) onClose?.(failure)
        },
        (error: unknown) => {
          if (!signal.aborted) onClose?.(error)
        },
      )
      return () => controller.abort()
    },
    async send(command) {
      const response = await request({
        accept: 'application/json',
        method: 'POST',
        body: JSON.stringify(command),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`the wire command answered HTTP ${response.status}`)
      }
      const ack: WireAck = await response.json()
      return ack
    },
  }
}

/** A frame candidate (`createMirror` checks every frame with `parseFrame`), or `undefined`. */
function parseJSON<S>(data: string): Frame<S> | undefined {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}
