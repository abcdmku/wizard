import { describe, expect, it, vi } from 'vitest'
import {
  decodeServerSentEvents,
  type ServerSentEvent,
  ServerSentEventSizeError,
} from '../src/client'

const encoder = new TextEncoder()

function byteStream(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function textStream(value: string): ReadableStream<Uint8Array> {
  return byteStream(encoder.encode(value))
}

async function collect(
  body: ReadableStream<Uint8Array>,
  options?: Parameters<typeof decodeServerSentEvents>[1],
): Promise<readonly ServerSentEvent[]> {
  const events: ServerSentEvent[] = []
  for await (const event of decodeServerSentEvents(body, options)) events.push(event)
  return events
}

describe('decodeServerSentEvents', () => {
  it('parses UTF-8 fields, comments, and CRLF, LF, or CR line endings', async () => {
    const body = textStream(
      '\uFEFF: keepalive\r\nid: 7\rdata: first\nevent: update\r\n' +
        'data: second\rretry: 1500\r\nignored: value\r\n\r\n' +
        'data: next\n\n',
    )

    await expect(collect(body)).resolves.toEqual([
      { data: 'first\nsecond', event: 'update', id: '7', retry: 1500 },
      { data: 'next', event: 'message', id: '7', retry: 1500 },
    ])
  })

  it('dispatches only blocks with data and discards an unterminated final block', async () => {
    const body = textStream(
      ': comment\n\n' +
        'id: saved\nretry: 42\n\n' +
        'event: ignored\n\n' +
        'data\n\n' +
        'data\ndata:\n\n' +
        'data: discarded',
    )

    await expect(collect(body)).resolves.toEqual([
      { data: '', event: 'message', id: 'saved', retry: 42 },
      { data: '\n', event: 'message', id: 'saved', retry: 42 },
    ])
  })

  it('compares field names literally and removes at most one value-leading space', async () => {
    const body = textStream('Data: ignored\ndata:  kept:colon\n\n')

    await expect(collect(body)).resolves.toEqual([{ data: ' kept:colon', event: 'message' }])
  })

  it('inherits ids, ignores ids containing NUL, and preserves an explicit reset', async () => {
    const body = textStream(
      'data: initial\n\n' +
        'id: first\ndata: one\n\n' +
        'id: bad\0id\nevent: custom\ndata: two\n\n' +
        'id\ndata: three\n\n' +
        'data: four\n\n',
    )

    await expect(collect(body)).resolves.toEqual([
      { data: 'initial', event: 'message' },
      { data: 'one', event: 'message', id: 'first' },
      { data: 'two', event: 'custom', id: 'first' },
      { data: 'three', event: 'message', id: '' },
      { data: 'four', event: 'message', id: '' },
    ])
  })

  it('accepts only ASCII retry integers that fit safely in a number', async () => {
    const body = textStream(
      'retry: 100\ndata: one\n\n' +
        'retry: -1\nretry: 1.5\nretry:\ndata: two\n\n' +
        'retry: 0007\ndata: three\n\n' +
        'retry: 9007199254740992\ndata: four\n\n',
    )

    await expect(collect(body)).resolves.toEqual([
      { data: 'one', event: 'message', retry: 100 },
      { data: 'two', event: 'message', retry: 100 },
      { data: 'three', event: 'message', retry: 7 },
      { data: 'four', event: 'message', retry: 7 },
    ])
  })

  it('keeps multibyte characters intact across arbitrary chunk boundaries', async () => {
    const bytes = encoder.encode('data: 🧙\r\n\r\ndata: tail\n\n')
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte))

    await expect(collect(byteStream(...chunks))).resolves.toEqual([
      { data: '🧙', event: 'message' },
      { data: 'tail', event: 'message' },
    ])
  })

  it('flushes malformed UTF-8 before dispatching a completed line', async () => {
    const prefix = encoder.encode('data: value ')
    const bytes = new Uint8Array(prefix.byteLength + 4)
    bytes.set(prefix)
    bytes.set([0xf0, 0x9f, 0x0a, 0x0a], prefix.byteLength)

    await expect(collect(byteStream(bytes))).resolves.toEqual([
      { data: 'value �', event: 'message' },
    ])
  })

  it('validates maxEventBytes before iteration starts', () => {
    const body = textStream('')

    for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => decodeServerSentEvents(body, { maxEventBytes: value })).toThrow(
        'maxEventBytes must be a positive safe integer',
      )
    }
  })

  it('bounds each raw event block and exposes a typed size error', async () => {
    const encodedLine = encoder.encode('data: 🧙')
    const body = textStream('data: 🧙\n\n')
    const maxEventBytes = encodedLine.byteLength - 1

    let failure: unknown
    try {
      await collect(body, { maxEventBytes })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(ServerSentEventSizeError)
    expect(failure).toMatchObject({
      name: 'ServerSentEventSizeError',
      code: 'SSE_EVENT_TOO_LARGE',
      maxEventBytes,
      eventBytes: encodedLine.byteLength,
    })
  })

  it('resets the size count at blank lines and also bounds comment-only blocks', async () => {
    await expect(
      collect(textStream('data: a\n\ndata: b\n\n'), { maxEventBytes: 7 }),
    ).resolves.toHaveLength(2)

    await expect(
      collect(textStream(': 12345678\n\n'), { maxEventBytes: 8 }),
    ).rejects.toBeInstanceOf(ServerSentEventSizeError)
  })

  it('propagates abort reasons, cancels pending reads, and releases the reader', async () => {
    const abort = new AbortController()
    const reason = new Error('stop reading')
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })

    const pending = collect(body, { signal: abort.signal })
    abort.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledWith(reason)
    expect(body.locked).toBe(false)
  })

  it('cancels when iteration ends early and releases after every exit', async () => {
    const cancel = vi.fn()
    const openBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'))
      },
      cancel,
    })

    for await (const _event of decodeServerSentEvents(openBody)) break
    expect(cancel).toHaveBeenCalledOnce()
    expect(openBody.locked).toBe(false)

    const closedBody = textStream('data: done\n\n')
    await collect(closedBody)
    expect(closedBody.locked).toBe(false)

    const readFailure = new Error('read failed')
    const failedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(readFailure)
      },
    })
    await expect(collect(failedBody)).rejects.toBe(readFailure)
    expect(failedBody.locked).toBe(false)

    const oversizedCancel = vi.fn()
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: too large'))
      },
      cancel: oversizedCancel,
    })
    await expect(collect(oversizedBody, { maxEventBytes: 5 })).rejects.toBeInstanceOf(
      ServerSentEventSizeError,
    )
    expect(oversizedCancel).toHaveBeenCalledOnce()
    expect(oversizedBody.locked).toBe(false)
  })
})
