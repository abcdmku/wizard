import { PartnerIdentitySchema, WorkEnvelopeSchema, type WorkType } from '@fulfillment/contracts'
import Fastify from 'fastify'
import { z } from 'zod'
import { PartnerSimulator, SimulatedPartnerUnavailableError } from './simulator'

const ParamsSchema = z.object({ partner: PartnerIdentitySchema })

export function createPartnerApp(options: {
  readonly callbackDelayMs: number
  readonly webhookSecret: string
}) {
  const app = Fastify({ logger: true })
  const simulator = new PartnerSimulator(options)

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  app.get('/health', async () => ({ status: 'ok', service: 'partner-api' }))

  app.post('/internal/work/:partner', async (request, reply) => {
    const { partner } = ParamsSchema.parse(request.params)
    const job = WorkEnvelopeSchema.parse(parseBody(request.body))
    if (serviceFor(job.type) !== partner) {
      return reply.code(400).send({ error: { code: 'WRONG_PARTNER', message: 'Wrong partner' } })
    }
    const callbackUrl = requiredHeader(request.headers['x-callback-url'], 'x-callback-url')
    const callbackSecret = requiredHeader(request.headers['x-callback-secret'], 'x-callback-secret')
    if (callbackSecret !== options.webhookSecret) {
      return reply.code(401).send({
        error: { code: 'INVALID_WORKER_SECRET', message: 'Worker secret is invalid' },
      })
    }
    const idempotencyKey = requiredHeader(request.headers['idempotency-key'], 'idempotency-key')
    if (idempotencyKey !== job.eventId) {
      return reply.code(409).send({
        error: { code: 'IDEMPOTENCY_MISMATCH', message: 'Header does not match eventId' },
      })
    }
    try {
      return reply.code(202).send(simulator.accept(partner, job, callbackUrl, callbackSecret))
    } catch (error) {
      if (error instanceof SimulatedPartnerUnavailableError) {
        return reply.code(503).send({
          error: { code: 'SIMULATED_UNAVAILABLE', message: error.message },
        })
      }
      throw error
    }
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ error }, 'Partner request rejected')
    const status = error instanceof z.ZodError ? 400 : 500
    void reply.code(status).send({
      error: {
        code: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: status === 400 ? 'Invalid partner work request' : 'Partner simulator failed',
      },
    })
  })
  return app
}

function parseBody(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Expected a JSON request body')
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Request body is not valid JSON' }])
  }
}

function requiredHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`)
  return value
}

function serviceFor(type: WorkType): 'payment' | 'inventory' | 'shipping' {
  if (type.startsWith('payment.')) return 'payment'
  if (type.startsWith('inventory.')) return 'inventory'
  return 'shipping'
}
