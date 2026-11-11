import { WorkEnvelopeSchema } from '@fulfillment/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartnerSimulator } from '../apps/partner-api/src/simulator'

const job = WorkEnvelopeSchema.parse({
  eventId: 'payment-restart-retry',
  orderId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  tenantId: 'tenant-acme',
  type: 'payment.authorization.requested',
  attempt: 1,
  occurredAt: '2026-08-23T12:00:00.000Z',
  data: {
    tenantId: 'tenant-acme',
    orderId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
    callbackUrl: 'http://orchestrator:3001/api/webhooks/partner',
    idempotencyKey: 'payment-restart-retry',
    amountMinor: 4200,
    currency: 'USD',
  },
})

afterEach(() => {
  vi.useRealTimers()
})

describe('partner callback delivery', () => {
  it('keeps retrying through a realistic orchestrator restart window', async () => {
    vi.useFakeTimers()
    const statuses = [503, 503, 503, 202]
    const attempts: number[] = []
    const send = async () => {
      const status = statuses[attempts.length] ?? 202
      attempts.push(status)
      return new Response(null, { status })
    }
    const simulator = new PartnerSimulator({ callbackDelayMs: 10, fetch: send })

    simulator.accept('payment', job, 'http://orchestrator:3001/api/webhooks/partner', 'secret')
    await vi.advanceTimersByTimeAsync(200)

    expect(attempts).toEqual([503, 503, 503, 202])
  })
})
