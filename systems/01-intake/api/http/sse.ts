import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify'
import { type ApplicationView, ApplicationViewSchema } from '../../shared/api-contract.js'
import type { ApplicantViewer } from '../../shared/common.js'
import { type ApplicationStreamEvent, ApplicationStreamEventSchema } from '../../shared/sse.js'
import type { IntakeHttpService, IntakeHttpSubscription } from './types.js'

const DEFAULT_HEARTBEAT_MS = 15_000

export class IntakeStreamRegistry {
  readonly #close = new Set<() => Promise<void>>()

  add(close: () => Promise<void>): () => void {
    this.#close.add(close)
    return () => {
      this.#close.delete(close)
    }
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.#close]
    this.#close.clear()
    await Promise.all(sessions.map((close) => close()))
  }
}

function sequenceId(event: ApplicationStreamEvent): string | undefined {
  if (event.type === 'heartbeat') return undefined
  return `${event.data.workflow.epoch}:${event.data.workflow.seq}`
}

function writeEvent(reply: FastifyReply, event: ApplicationStreamEvent): void {
  const parsed = ApplicationStreamEventSchema.parse(event)
  const id = sequenceId(parsed)
  if (id !== undefined) reply.raw.write(`id: ${id}\n`)
  reply.raw.write(`event: ${parsed.type}\n`)
  reply.raw.write(`data: ${JSON.stringify(parsed)}\n\n`)
}

async function closeQuietly(
  subscription: IntakeHttpSubscription,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await subscription.close()
  } catch (error) {
    log.error({ err: error }, 'Failed to close an intake event subscription')
  }
}

export async function openApplicationStream(options: {
  readonly applicationId: string
  readonly heartbeatMs?: number
  readonly registry: IntakeStreamRegistry
  readonly reply: FastifyReply
  readonly request: FastifyRequest
  readonly scope: ApplicantViewer
  readonly service: IntakeHttpService
}): Promise<void> {
  const pending: ApplicationView[] = []
  let ready = false
  let closed = false
  const onApplication = (application: ApplicationView): void => {
    if (closed) return
    if (!ready) {
      pending.push(application)
      return
    }
    try {
      writeEvent(options.reply, { type: 'state', data: ApplicationViewSchema.parse(application) })
    } catch (error) {
      options.request.log.error({ err: error }, 'Closing an invalid intake event stream')
      options.reply.raw.destroy()
    }
  }

  const subscription = await options.service.subscribe(
    options.scope,
    options.applicationId,
    onApplication,
  )
  let initial: ApplicationView
  try {
    initial = ApplicationViewSchema.parse(subscription.initial)
  } catch (error) {
    await closeQuietly(subscription, options.request.log)
    throw error
  }

  options.reply.hijack()
  options.reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  options.reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
  options.reply.raw.setHeader('Connection', 'keep-alive')
  options.reply.raw.setHeader('X-Accel-Buffering', 'no')
  options.reply.raw.flushHeaders()
  options.reply.raw.write('retry: 1000\n\n')
  writeEvent(options.reply, { type: 'snapshot', data: initial })
  ready = true
  for (const application of pending) onApplication(application)
  pending.length = 0

  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const heartbeat = setInterval(() => {
    if (!closed) writeEvent(options.reply, { type: 'heartbeat', at: Date.now() })
  }, heartbeatMs)
  heartbeat.unref()

  let closePromise: Promise<void> | undefined
  let unregister = (): void => undefined
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise
    closed = true
    clearInterval(heartbeat)
    unregister()
    closePromise = closeQuietly(subscription, options.request.log)
    return closePromise
  }
  unregister = options.registry.add(close)
  const disconnected = (): void => {
    void close()
  }
  options.request.raw.once('aborted', disconnected)
  options.reply.raw.once('close', disconnected)
}
