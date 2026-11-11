import type { PartnerIdentity } from '@fulfillment/contracts'
import type { FastifyInstance } from 'fastify'
import type { FulfillmentApplicationService } from './application-service'
import { verifyPartnerDelivery } from './webhook'

export function registerWebhookRoute(
  app: FastifyInstance,
  service: FulfillmentApplicationService,
  secrets: Readonly<Record<PartnerIdentity, string>>,
): void {
  app.post('/api/webhooks/partner', async (request, reply) => {
    if (typeof request.body !== 'string') throw new Error('Raw webhook body is required')
    const delivery = verifyPartnerDelivery(
      request.body,
      {
        partner: request.headers['x-partner-id'],
        timestamp: request.headers['x-fulfillment-timestamp'],
        signature: request.headers['x-fulfillment-signature'],
      },
      secrets,
    )
    const result = await service.receivePartnerCallback(
      delivery.partner,
      delivery.callback,
      delivery.digest,
    )
    return reply.code(result.duplicate ? 200 : 202).send(result)
  })
}
