import type { RunStatus } from '@openwizard/core'
import type { Frame, MirrorSource } from '@openwizard/core/mirror'

/** Run statuses after which nothing changes (`halted` is recoverable, so its stream stays open). */
const TERMINAL: ReadonlySet<unknown> = new Set([
  'done',
  'failed',
  'cancelled',
] satisfies RunStatus[])

/**
 * A `text/event-stream` response of Mirror frames: the current frame at once, then one per
 * committed batch, plus opted-in transient progress. Every SSE event is named `frame`; only
 * snapshots set the id `<epoch>:<seq>`. The stream ends
 * when the projected status is terminal, when the source is disposed, or when the client
 * disconnects; `onEnd` runs then.
 */
export function frameStream<S>(
  source: MirrorSource<S>,
  request: Request,
  onEnd: () => void,
): Response {
  const encoder = new TextEncoder()
  let stop = (): void => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const close = () => {
        if (!open) return
        open = false
        stop()
        request.signal.removeEventListener('abort', close)
        controller.close()
        onEnd()
      }
      stop = source.subscribe((frame) => {
        if (!open) return
        controller.enqueue(encoder.encode(serialize(frame)))
        if (isTerminal(frame)) queueMicrotask(close)
      }, close)
      if (request.signal.aborted) close()
      else request.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      stop()
      onEnd()
    },
  })
  return new Response(body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    },
  })
}

/** Only snapshot frames set the SSE `id`: a reconnect resumes from committed state, never from progress. */
function serialize(frame: Frame<unknown>): string {
  const id = frame.kind === 'snapshot' ? `id: ${frame.epoch}:${frame.seq}\n` : ''
  return `${id}event: frame\ndata: ${JSON.stringify(frame)}\n\n`
}

function isTerminal(frame: Frame<unknown>): boolean {
  if (frame.kind !== 'snapshot') return false
  const state: unknown = frame.state
  return (
    typeof state === 'object' && state !== null && 'status' in state && TERMINAL.has(state.status)
  )
}
