import { expectTypeOf } from 'vitest'
import {
  decodeServerSentEvents,
  type ServerSentEvent,
  ServerSentEventSizeError,
} from '../src/client'

declare const body: ReadableStream<Uint8Array>
declare const signal: AbortSignal

const events = decodeServerSentEvents(body, { signal, maxEventBytes: 1024 })
expectTypeOf(events).toEqualTypeOf<AsyncIterable<ServerSentEvent>>()

for await (const event of events) {
  expectTypeOf(event.data).toEqualTypeOf<string>()
  expectTypeOf(event.event).toEqualTypeOf<string>()
  expectTypeOf(event.id).toEqualTypeOf<string | undefined>()
  expectTypeOf(event.retry).toEqualTypeOf<number | undefined>()
}

const error = new ServerSentEventSizeError(10, 11)
expectTypeOf(error.code).toEqualTypeOf<'SSE_EVENT_TOO_LARGE'>()
expectTypeOf(error.maxEventBytes).toEqualTypeOf<number>()
expectTypeOf(error.eventBytes).toEqualTypeOf<number>()

// @ts-expect-error SSE decoding requires a byte stream
decodeServerSentEvents(new ReadableStream<string>())

// @ts-expect-error maxEventBytes is measured as a number
decodeServerSentEvents(body, { maxEventBytes: '1024' })
