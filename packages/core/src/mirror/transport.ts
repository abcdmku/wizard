/**
 * `Transport<S>` — the one interface a host implements to connect a Mirror to a server
 * (SSE + POST, WebSocket, postMessage, …). `createLocalTransport` is the in-process loopback.
 *
 * @packageDocumentation
 */

import type { Frame, WireAck, WireCommand } from './wire'

/**
 * Client-side transport of the wire protocol: `subscribe` delivers frames (the server sends the
 * current frame on subscribe, then one per committed batch); `send` delivers a `WireCommand`
 * and resolves with its `WireAck`. Rejections of `send` (network failures) propagate to the
 * Mirror caller unchanged.
 * @public
 */
export interface Transport<S> {
  subscribe(onFrame: (frame: Frame<S>) => void): () => void
  send(command: WireCommand): Promise<WireAck>
}
