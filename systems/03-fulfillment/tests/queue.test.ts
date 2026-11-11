import { describe, expect, it, vi } from 'vitest'
import { parseSnsWorkEnvelope, type WorkEnvelope } from '../lambdas/src/contracts'
import { createPartnerWorker } from '../lambdas/src/worker'

const NOW = '2026-08-23T15:00:00.000Z'
const ORDER_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538'

function job(type: WorkEnvelope['type']): WorkEnvelope {
  return {
    eventId: 'evt-1',
    orderId: ORDER_ID,
    tenantId: 'tenant-acme',
    type,
    attempt: 1,
    occurredAt: NOW,
    data: { amountMinor: 4200 },
  }
}

function sns(jobValue: WorkEnvelope, eventType = jobValue.type): string {
  return JSON.stringify({
    Type: 'Notification',
    Message: JSON.stringify(jobValue),
    MessageAttributes: { eventType: { Type: 'String', Value: eventType } },
  })
}

function record(body: string, messageId = 'sqs-1') {
  return {
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body,
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1',
      SenderId: 'localstack',
      ApproximateFirstReceiveTimestamp: '1',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:fulfillment-payment-work',
    awsRegion: 'us-east-1',
  }
}

describe('SNS to SQS work envelope', () => {
  it('parses the typed envelope and routes only matching service work', () => {
    expect(parseSnsWorkEnvelope(sns(job('payment.authorization.requested')), 'payment')).toEqual(
      job('payment.authorization.requested'),
    )
    expect(() =>
      parseSnsWorkEnvelope(sns(job('payment.authorization.requested')), 'inventory'),
    ).toThrow(/cannot be processed/)
  })

  it('rejects malformed JSON, an attribute mismatch, and an unknown type', () => {
    expect(() => parseSnsWorkEnvelope('{', 'payment')).toThrow(/JSON/)
    expect(() =>
      parseSnsWorkEnvelope(
        sns(job('payment.authorization.requested'), 'payment.capture.requested'),
        'payment',
      ),
    ).toThrow(/does not match/)
    const unknown = JSON.stringify({
      Type: 'Notification',
      Message: JSON.stringify({ ...job('payment.authorization.requested'), type: 'fraud.unknown' }),
      MessageAttributes: { eventType: { Type: 'String', Value: 'fraud.unknown' } },
    })
    expect(() => parseSnsWorkEnvelope(unknown, 'payment')).toThrow()
  })

  it('returns batch item failures for a malformed record and keeps duplicate keys stable', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const oldEnvironment = {
      PARTNER_API_URL: process.env.PARTNER_API_URL,
      ORCHESTRATION_CALLBACK_URL: process.env.ORCHESTRATION_CALLBACK_URL,
      PARTNER_WEBHOOK_SECRET: process.env.PARTNER_WEBHOOK_SECRET,
      REQUEST_TIMEOUT_MS: process.env.REQUEST_TIMEOUT_MS,
      WORK_SERVICE: process.env.WORK_SERVICE,
    }
    process.env.PARTNER_API_URL = 'http://partner-api:3002/internal/work/payment'
    process.env.ORCHESTRATION_CALLBACK_URL = 'http://orchestrator:3001/api/webhooks/partner'
    process.env.PARTNER_WEBHOOK_SECRET = 'local-partner-webhook-secret'
    process.env.REQUEST_TIMEOUT_MS = '8000'
    process.env.WORK_SERVICE = 'payment'
    try {
      const handler = createPartnerWorker('payment')
      const duplicate = await handler({
        Records: [
          record(sns(job('payment.authorization.requested'))),
          record(sns(job('payment.authorization.requested')), 'sqs-2'),
        ],
      })
      expect(duplicate.batchItemFailures).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'idempotency-key': 'evt-1' }),
        }),
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'idempotency-key': 'evt-1' }),
        }),
      )

      const malformed = await handler({ Records: [record('{', 'sqs-bad')] })
      expect(malformed.batchItemFailures).toEqual([{ itemIdentifier: 'sqs-bad' }])
    } finally {
      restoreEnvironment(oldEnvironment)
      vi.unstubAllGlobals()
    }
  })
})

function restoreEnvironment(environment: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
