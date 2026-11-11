import { FraudDecisionSchema, type OperatorPrincipal } from '@fulfillment/contracts'
import type { FastifyInstance } from 'fastify'
import type { FulfillmentApplicationService } from './application-service'
import type { BearerAuthenticator } from './auth'
import {
  FraudBodySchema,
  FraudParamsSchema,
  idempotencyKey,
  OrderParamsSchema,
  parseJsonBody,
} from './http'

export function registerOperatorRoutes(
  app: FastifyInstance,
  service: FulfillmentApplicationService,
  auth: BearerAuthenticator,
): void {
  const principal = (authorization: string | string[] | undefined): OperatorPrincipal => {
    const authenticated = auth.authenticate(authorization, 'operator')
    if (authenticated.role !== 'operator') throw new Error('Operator authentication failed')
    return authenticated
  }

  app.get('/api/operator/orders', async (request) => {
    const actor = principal(request.headers.authorization)
    return { orders: await service.listOperatorOrders(actor) }
  })

  app.get('/api/operator/orders/:id', async (request) => {
    const actor = principal(request.headers.authorization)
    const { id } = OrderParamsSchema.parse(request.params)
    return { order: await service.getOperatorOrder(actor, id) }
  })

  app.post('/api/operator/orders/:id/fraud/:action', async (request) => {
    const actor = principal(request.headers.authorization)
    const { id, action } = FraudParamsSchema.parse(request.params)
    const body = FraudBodySchema.parse(parseJsonBody(request.body))
    const review = FraudDecisionSchema.parse({
      decision: action,
      ...(body.note === undefined ? {} : { note: body.note }),
    })
    const key = idempotencyKey(request.headers['idempotency-key'])
    return { order: await service.reviewFraud(actor, id, review, key) }
  })
}
