import type { AuthPrincipal, PartnerIdentity } from '@fulfillment/contracts'
import Fastify from 'fastify'
import { z } from 'zod'
import type { FulfillmentApplicationService } from './application-service'
import { BearerAuthenticator } from './auth'
import { registerCustomerRoutes } from './customer-routes'
import { FulfillmentServiceError } from './errors'
import { registerOperatorRoutes } from './operator-routes'
import { seedDemo } from './seed'
import { registerWebhookRoute } from './webhook-route'

interface ServerOptions {
  readonly service: FulfillmentApplicationService
  readonly authTokens: Readonly<Record<string, AuthPrincipal>>
  readonly webhookSecrets: Readonly<Record<PartnerIdentity, string>>
  readonly seedKey: string
  healthCheck(): Promise<void>
}

export function createOrchestratorApp(options: ServerOptions) {
  const app = Fastify({ logger: true })
  const auth = new BearerAuthenticator(options.authTokens)

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  app.get('/health', async (_request, reply) => {
    try {
      await options.healthCheck()
      return { status: 'ok', service: 'orchestrator', database: 'up' }
    } catch {
      return reply.code(503).send({ status: 'unavailable', service: 'orchestrator' })
    }
  })

  app.post('/api/dev/seed', async (request) => {
    if (request.headers['x-seed-key'] !== options.seedKey) {
      throw new FulfillmentServiceError('FORBIDDEN', 'Seed key is invalid', 403)
    }
    return { seeded: true, orders: await seedDemo(options.service) }
  })

  registerCustomerRoutes(app, options.service, auth)
  registerOperatorRoutes(app, options.service, auth)
  registerWebhookRoute(app, options.service, options.webhookSecrets)

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof FulfillmentServiceError) {
      if (error.statusCode === 401) reply.header('www-authenticate', 'Bearer')
      if (error.retryAt !== undefined) {
        reply.header(
          'retry-after',
          String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))),
        )
      }
      void reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      })
      return
    }
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
          requestId: request.id,
          details: error.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        },
      })
      return
    }
    request.log.error({ error }, 'Unhandled orchestrator error')
    void reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: request.id },
    })
  })

  return app
}
