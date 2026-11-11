import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import { z } from 'zod'
import {
  type PartnerService,
  parseSnsWorkEnvelope,
  partnerServiceSchema,
  type WorkEnvelope,
} from './contracts'

const environmentSchema = z.object({
  PARTNER_API_URL: z.url(),
  ORCHESTRATION_CALLBACK_URL: z.url(),
  PARTNER_WEBHOOK_SECRET: z.string().min(1),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000),
  WORK_SERVICE: partnerServiceSchema,
})

type BatchFailure = SQSBatchResponse['batchItemFailures'][number]

export function createPartnerWorker(service: PartnerService) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const environment = environmentSchema.parse(process.env)
    if (environment.WORK_SERVICE !== service) {
      throw new Error(`Lambda is configured for ${environment.WORK_SERVICE}, not ${service}`)
    }

    const failures = await Promise.all(
      event.Records.map((record) => handleRecord(record, service, environment)),
    )

    return { batchItemFailures: failures.filter(isBatchFailure) }
  }
}

async function handleRecord(
  record: SQSRecord,
  service: PartnerService,
  environment: z.infer<typeof environmentSchema>,
): Promise<BatchFailure | undefined> {
  let job: WorkEnvelope | undefined

  try {
    job = parseSnsWorkEnvelope(record.body, service)
    await postToPartner(job, environment)
    return undefined
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        message: 'Partner work item failed',
        service,
        messageId: record.messageId,
        eventId: job?.eventId,
        error: safeErrorMessage(error),
      })}\n`,
    )
    return { itemIdentifier: record.messageId }
  }
}

async function postToPartner(
  job: WorkEnvelope,
  environment: z.infer<typeof environmentSchema>,
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), environment.REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(environment.PARTNER_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': job.eventId,
        'x-callback-url': environment.ORCHESTRATION_CALLBACK_URL,
        'x-callback-secret': environment.PARTNER_WEBHOOK_SECRET,
      },
      body: JSON.stringify(job),
      signal: controller.signal,
    })

    await response.body?.cancel()
    if (!response.ok) {
      throw new Error(`Partner returned HTTP ${response.status}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

function isBatchFailure(value: BatchFailure | undefined): value is BatchFailure {
  return value !== undefined
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 500)
  }
  return 'Unknown worker error'
}
