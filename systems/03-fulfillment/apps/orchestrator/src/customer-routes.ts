import {
  CancelOrderSchema,
  CreateOrderSchema,
  type CustomerPrincipal,
} from '@fulfillment/contracts'
import type { FastifyInstance } from 'fastify'
import type { FulfillmentApplicationService } from './application-service'
import type { BearerAuthenticator } from './auth'
import { idempotencyKey, OrderParamsSchema, parseJsonBody } from './http'

export function registerCustomerRoutes(
  app: FastifyInstance,
  service: FulfillmentApplicationService,
  auth: BearerAuthenticator,
): void {
  const principal = (authorization: string | string[] | undefined): CustomerPrincipal => {
    const authenticated = auth.authenticate(authorization, 'customer')
    if (authenticated.role !== 'customer') throw new Error('Customer authentication failed')
    return authenticated
  }

  app.post('/api/customer/orders', async (request, reply) => {
    const actor = principal(request.headers.authorization)
    const input = CreateOrderSchema.parse(parseJsonBody(request.body))
    const key = idempotencyKey(request.headers['idempotency-key'])
    const result = await service.createOrder(actor, input, key)
    return reply.code(result.replayed ? 200 : 201).send({ order: result.order })
  })

  app.get('/api/customer/orders', async (request) => {
    const actor = principal(request.headers.authorization)
    return { orders: await service.listCustomerOrders(actor) }
  })

  app.get('/api/customer/orders/:id', async (request) => {
    const actor = principal(request.headers.authorization)
    const { id } = OrderParamsSchema.parse(request.params)
    return { order: await service.getCustomerOrder(actor, id) }
  })

  app.post('/api/customer/orders/:id/cancel', async (request) => {
    const actor = principal(request.headers.authorization)
    const { id } = OrderParamsSchema.parse(request.params)
    const { reason } = CancelOrderSchema.parse(parseJsonBody(request.body))
    const key = idempotencyKey(request.headers['idempotency-key'])
    return { order: await service.cancelOrder(actor, id, reason, key) }
  })
}
