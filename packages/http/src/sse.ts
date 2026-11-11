const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024
const CR = 0x0d
const LF = 0x0a

/** One event decoded from a `text/event-stream` response body. @public */
export interface ServerSentEvent {
  readonly data: string
  readonly event: string
  readonly id?: string
  readonly retry?: number
}

/** Error thrown when one event-stream block exceeds its configured byte limit. @public */
export class ServerSentEventSizeError extends Error {
  readonly code: 'SSE_EVENT_TOO_LARGE' = 'SSE_EVENT_TOO_LARGE'
  readonly maxEventBytes: number
  readonly eventBytes: number

  constructor(maxEventBytes: number, eventBytes: number) {
    super(`server-sent event exceeds the ${maxEventBytes}-byte limit`)
    this.name = 'ServerSentEventSizeError'
    this.maxEventBytes = maxEventBytes
    this.eventBytes = eventBytes
  }
}

type LastEventId = { readonly set: false } | { readonly set: true; readonly value: string }

interface EventState {
  readonly data: string[]
  event: string
  lastEventId: LastEventId
  retry?: number
  blockBytes: number
}

/**
 * Decode a framework-neutral byte stream using the `text/event-stream` parsing rules.
 *
 * The default per-block limit is 1 MiB. The limit counts the raw bytes on non-empty lines,
 * including comments and unknown fields, but excludes line endings and the dispatching blank line.
 *
 * @public
 */
export function decodeServerSentEvents(
  body: ReadableStream<Uint8Array>,
  options: {
    readonly signal?: AbortSignal
    readonly maxEventBytes?: number
  } = {},
): AsyncIterable<ServerSentEvent> {
  const maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes <= 0) {
    throw new TypeError('maxEventBytes must be a positive safe integer')
  }
  return readEvents(body, maxEventBytes, options.signal)
}

async function* readEvents(
  body: ReadableStream<Uint8Array>,
  maxEventBytes: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const lineBytes: number[] = []
  const state: EventState = {
    data: [],
    event: '',
    lastEventId: { set: false },
    blockBytes: 0,
  }
  let afterCR = false
  let finished = false
  let failed = false
  let failure: unknown

  try {
    if (signal?.aborted) throw signal.reason
    while (true) {
      const result = await readChunk(reader, signal)
      if (result.done) {
        decoder.decode(Uint8Array.from(lineBytes))
        finished = true
        return
      }

      for (const byte of result.value) {
        if (afterCR) {
          afterCR = false
          if (byte === LF) continue
        }
        if (byte === CR || byte === LF) {
          const line = decodeLine(decoder, lineBytes, byte)
          if (line !== '') state.blockBytes += lineBytes.length
          lineBytes.length = 0
          if (byte === CR) afterCR = true
          const event = processLine(state, line)
          if (event !== undefined) yield event
          continue
        }

        lineBytes.push(byte)
        const eventBytes = state.blockBytes + lineBytes.length
        if (eventBytes > maxEventBytes) {
          throw new ServerSentEventSizeError(maxEventBytes, eventBytes)
        }
      }
    }
  } catch (error) {
    failed = true
    failure = error
    throw error
  } finally {
    try {
      if (!finished) {
        await cancelReader(reader, failed ? failure : undefined)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason)
  } catch {
    return
  }
}

function decodeLine(decoder: TextDecoder, line: readonly number[], ending: number): string {
  const bytes = new Uint8Array(line.length + 1)
  bytes.set(line)
  bytes[line.length] = ending
  const decoded = decoder.decode(bytes, { stream: true })
  return decoded.slice(0, -1)
}

function processLine(state: EventState, line: string): ServerSentEvent | undefined {
  if (line === '') return dispatch(state)
  if (line.startsWith(':')) return undefined

  const colon = line.indexOf(':')
  const field = colon === -1 ? line : line.slice(0, colon)
  let value = colon === -1 ? '' : line.slice(colon + 1)
  if (value.startsWith(' ')) value = value.slice(1)

  switch (field) {
    case 'data':
      state.data.push(value)
      break
    case 'event':
      state.event = value
      break
    case 'id':
      if (!value.includes('\0')) state.lastEventId = { set: true, value }
      break
    case 'retry': {
      if (!/^[0-9]+$/.test(value)) break
      const retry = Number(value)
      if (Number.isSafeInteger(retry)) state.retry = retry
      break
    }
  }
  return undefined
}

function dispatch(state: EventState): ServerSentEvent | undefined {
  state.blockBytes = 0
  const data = state.data.join('\n')
  const eventName = state.event || 'message'
  const hasData = state.data.length > 0
  state.data.length = 0
  state.event = ''
  if (!hasData) return undefined

  return {
    data,
    event: eventName,
    ...(state.lastEventId.set ? { id: state.lastEventId.value } : {}),
    ...(state.retry === undefined ? {} : { retry: state.retry }),
  }
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal === undefined) return reader.read()
  if (signal.aborted) return Promise.reject(signal.reason)

  return new Promise((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    reader.read().then(
      (result) => {
        cleanUp()
        resolve(result)
      },
      (error: unknown) => {
        cleanUp()
        reject(error)
      },
    )
  })
}
