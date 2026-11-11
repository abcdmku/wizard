import {
  type PartnerIdentity,
  PartnerIdentitySchema,
  type WorkEnvelope,
  WorkEnvelopeSchema,
  type WorkType,
  WorkTypeSchema,
  workTypesByService,
} from '@fulfillment/contracts'
import { z } from 'zod'

export type { PartnerIdentity as PartnerService, WorkEnvelope, WorkType }
export {
  PartnerIdentitySchema as partnerServiceSchema,
  WorkEnvelopeSchema as workEnvelopeSchema,
  WorkTypeSchema as workTypeSchema,
  workTypesByService,
}

const snsMessageAttributeSchema = z
  .object({
    Type: z.string(),
    Value: z.string(),
  })
  .passthrough()

const snsEnvelopeSchema = z
  .object({
    Type: z.literal('Notification'),
    Message: z.string(),
    MessageAttributes: z.record(z.string(), snsMessageAttributeSchema),
  })
  .passthrough()

export function parseSnsWorkEnvelope(body: string, service: PartnerIdentity): WorkEnvelope {
  const notification = snsEnvelopeSchema.parse(parseJson(body))
  const job = WorkEnvelopeSchema.parse(parseJson(notification.Message))
  const eventType = notification.MessageAttributes.eventType

  if (eventType?.Value !== job.type) {
    throw new Error('SNS eventType does not match the work envelope type')
  }

  if (!workTypesByService[service].includes(job.type)) {
    throw new Error(`Work type ${job.type} cannot be processed by ${service}`)
  }

  return job
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    throw new Error('Queue record contains invalid JSON')
  }
}
