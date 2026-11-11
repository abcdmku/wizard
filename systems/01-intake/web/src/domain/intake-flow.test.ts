import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  connectEventStream,
  EventStreamMessageError,
  type EventStreamStatus,
  type TypedServerEvent,
} from '../api/events'
import { reviewerRefreshInterval } from '../hooks/use-intake-api'
import { isApplicantStep, progressSteps, serverStepFor, stepFromStatus } from './steps'

describe('applicant route model', () => {
  it('maps durable statuses to the page an applicant can act on', () => {
    expect(stepFromStatus('draft')).toBe('consent')
    expect(stepFromStatus('prefilling')).toBe('business')
    expect(stepFromStatus('hardship-evidence')).toBe('eligibility')
    expect(stepFromStatus('changes-requested')).toBe('review')
    expect(stepFromStatus('awaiting-reviewer')).toBe('risk')
    expect(stepFromStatus('approved')).toBe('result')
  })

  it('keeps the incorporated owner branch explicit', () => {
    expect(serverStepFor('owners')).toBe('beneficialOwners')
    expect(progressSteps(false).map((step) => step.id)).not.toContain('owners')
    expect(progressSteps(true).map((step) => step.id)).toContain('owners')
    expect(isApplicantStep('owners')).toBe(true)
    expect(isApplicantStep('admin')).toBe(false)
  })
})

const StreamPayloadSchema = z.object({ type: z.literal('state'), count: z.number() })
type StreamPayload = z.infer<typeof StreamPayloadSchema>

function eventStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('event stream client', () => {
  it('validates events, reports failures, and resumes from the last event id', async () => {
    const events: TypedServerEvent<StreamPayload>[] = []
    const errors: Error[] = []
    const statuses: EventStreamStatus[] = []
    let requestCount = 0
    let resumeHeader: string | null = null
    let resolveReconnect: (() => void) | undefined
    const reconnected = new Promise<void>((resolve) => {
      resolveReconnect = resolve
    })
    const send: typeof globalThis.fetch = async (_input, init) => {
      requestCount += 1
      if (requestCount === 1) {
        return new Response(
          eventStream(
            'id: 41\nevent: state\ndata: {"type":"state","count":"bad"}\n\n',
            'retry: 1\nid: 42\nevent: state\ndata: {"type":"state","count":2}\n\n',
          ),
          { status: 200 },
        )
      }

      resumeHeader = new Headers(init?.headers).get('Last-Event-ID')
      resolveReconnect?.()
      return new Response(null, { status: 204 })
    }

    const subscription = connectEventStream('/events', StreamPayloadSchema, {
      baseUrl: 'https://intake.test',
      fetch: send,
      onError: (error) => errors.push(error),
      onEvent: (event) => events.push(event),
      onStatusChange: (status) => statuses.push(status),
      retryDelayMs: 50,
    })

    await reconnected
    await vi.waitFor(() => expect(subscription.status).toBe('closed'))
    expect(requestCount).toBe(2)
    expect(resumeHeader).toBe('42')
    expect(events).toEqual([{ data: { type: 'state', count: 2 }, event: 'state', id: '42' }])
    expect(errors.some((error) => error instanceof EventStreamMessageError)).toBe(true)
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'closed'])
  })
})

describe('reviewer live refresh', () => {
  it('polls active views and stops after a terminal decision', () => {
    expect(reviewerRefreshInterval(undefined)).toBe(false)
    expect(reviewerRefreshInterval('draft')).toBe(500)
    expect(reviewerRefreshInterval('awaiting-reviewer')).toBe(500)
    expect(reviewerRefreshInterval('approved')).toBe(false)
    expect(reviewerRefreshInterval('rejected')).toBe(false)
    expect(reviewerRefreshInterval('cancelled')).toBe(false)
  })
})
