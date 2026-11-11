/**
 * `Transport<S>` — the one interface a host implements to connect a Mirror to a server
 * (SSE + POST, WebSocket, postMessage, …). `createLocalTransport` is the in-process loopback.
 *
 * @packageDocumentation
 */

import type { Frame, WireAck, WireCommand } from './wire'

/**
 * Client-side transport of the wire protocol: `subscribe` delivers frames (the server sends the
 * current snapshot frame on subscribe, then one per committed batch, interleaved with progress
 * frames) and calls `onClose` once when the
 * frame stream ends (network drop, server gone) — the Mirror then reports `connected: false`
 * until `mirror.connect()` subscribes again. `send` delivers a `WireCommand` and resolves with
 * its `WireAck`; a rejection (network failure) becomes a `TRANSPORT_FAILED` result on the
 * Mirror side.
 * @public
 */
export interface Transport<S> {
  subscribe(onFrame: (frame: Frame<S>) => void, onClose?: (error?: unknown) => void): () => void
  send(command: WireCommand): Promise<WireAck>
}
