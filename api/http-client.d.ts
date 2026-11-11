import { Transport } from "@openwizard/core/mirror";
//#region src/sse.d.ts
/** One event decoded from a `text/event-stream` response body. @public */
interface ServerSentEvent {
  readonly data: string;
  readonly event: string;
  readonly id?: string;
  readonly retry?: number;
}
/** Error thrown when one event-stream block exceeds its configured byte limit. @public */
declare class ServerSentEventSizeError extends Error {
  readonly code: 'SSE_EVENT_TOO_LARGE';
  readonly maxEventBytes: number;
  readonly eventBytes: number;
  constructor(maxEventBytes: number, eventBytes: number);
}
/**
 * Decode a framework-neutral byte stream using the `text/event-stream` parsing rules.
 *
 * The default per-block limit is 1 MiB. The limit counts the raw bytes on non-empty lines,
 * including comments and unknown fields, but excludes line endings and the dispatching blank line.
 *
 * @public
 */
declare function decodeServerSentEvents(body: ReadableStream<Uint8Array>, options?: {
  readonly signal?: AbortSignal;
  readonly maxEventBytes?: number;
}): AsyncIterable<ServerSentEvent>;
//#endregion
//#region src/client.d.ts
/** Options of `httpTransport`. @public */
interface HTTPTransportOptions {
  /** The fetch to call. Defaults to `globalThis.fetch`; pass `http.fetch` to test in-process. */
  readonly fetch?: (request: Request) => Promise<Response>;
  /** Headers of every request, such as `authorization`. A function is called per request. */
  readonly headers?: HeadersInit | (() => HeadersInit | PromiseLike<HeadersInit>);
}
/**
 * A Mirror `Transport` over a run's generated stream route (`<base>/<runId>/stream`):
 * `subscribe` reads its server-sent frames (and reports `onClose` when the server ends the
 * stream or the connection drops), `send` POSTs a `WireCommand` and resolves with its `WireAck`.
 * Type it through the Mirror: `createMirror<typeof projection>({ transport: httpTransport(url) })`.
 * @public
 */
declare function httpTransport<S>(url: string | URL, options?: HTTPTransportOptions): Transport<S>;
//#endregion
export { HTTPTransportOptions, type ServerSentEvent, ServerSentEventSizeError, decodeServerSentEvents, httpTransport };
//# sourceMappingURL=client.d.ts.map