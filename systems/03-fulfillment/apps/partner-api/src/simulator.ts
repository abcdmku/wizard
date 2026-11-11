import { createHash } from 'node:crypto'
import {
  AuthorizePaymentRequestSchema,
  CapturePaymentRequestSchema,
  CreateShipmentRequestSchema,
  type PartnerAccepted,
  type PartnerCallback,
  type PartnerIdentity,
  ReserveInventoryRequestSchema,
  ReversalRequestSchema,
  type WorkEnvelope,
} from '@fulfillment/contracts'
import { signWebhook } from '@fulfillment/contracts/signing'

interface SimulationOptions {
  readonly callbackDelayMs: number
  readonly fetch?: typeof fetch
}

interface AcceptedWork {
  readonly requestId: string
  readonly callback?: PartnerCallback
}

const MAX_CALLBACK_ATTEMPTS = 6

export class PartnerSimulator {
  private readonly accepted = new Map<string, AcceptedWork>()
  private readonly attempts = new Map<string, number>()
  private readonly send: typeof fetch

  constructor(private readonly options: SimulationOptions) {
    this.send = options.fetch ?? fetch
  }

  accept(
    partner: PartnerIdentity,
    job: WorkEnvelope,
    callbackUrl: string,
    callbackSecret: string,
  ): PartnerAccepted {
    const attempt = (this.attempts.get(job.eventId) ?? 0) + 1
    this.attempts.set(job.eventId, attempt)
    rejectForSimulation(job, attempt)

    const previous = this.accepted.get(job.eventId)
    if (previous !== undefined) {
      this.schedule(partner, previous.callback, callbackUrl, callbackSecret)
      return { accepted: true, requestId: previous.requestId, duplicate: true }
    }

    const accepted = {
      requestId: resourceId('request', job.eventId),
      ...callbackFor(job),
    }
    this.accepted.set(job.eventId, accepted)
    this.schedule(partner, accepted.callback, callbackUrl, callbackSecret)
    return { accepted: true, requestId: accepted.requestId, duplicate: false }
  }

  private schedule(
    partner: PartnerIdentity,
    callback: PartnerCallback | undefined,
    callbackUrl: string,
    secret: string,
  ): void {
    if (callback === undefined) return
    setTimeout(() => {
      void this.deliver(partner, callback, callbackUrl, secret, 1)
    }, this.options.callbackDelayMs)
  }

  private async deliver(
    partner: PartnerIdentity,
    callback: PartnerCallback,
    callbackUrl: string,
    secret: string,
    attempt: number,
  ): Promise<void> {
    const rawBody = JSON.stringify(callback)
    const timestamp = String(Math.floor(Date.now() / 1_000))
    try {
      const response = await this.send(callbackUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-partner-id': partner,
          'x-fulfillment-timestamp': timestamp,
          'x-fulfillment-signature': signWebhook(secret, timestamp, rawBody),
        },
        body: rawBody,
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error(`callback returned HTTP ${response.status}`)
      if (attempt === 1) {
        setTimeout(() => {
          void this.deliver(partner, callback, callbackUrl, secret, 4)
        }, this.options.callbackDelayMs)
      }
    } catch (error) {
      if (attempt >= MAX_CALLBACK_ATTEMPTS) {
        process.stderr.write(`Partner callback failed: ${safeMessage(error)}\n`)
        return
      }
      setTimeout(
        () => {
          void this.deliver(partner, callback, callbackUrl, secret, attempt + 1)
        },
        this.options.callbackDelayMs * 2 ** attempt,
      )
    }
  }
}

export class SimulatedPartnerUnavailableError extends Error {}

function callbackFor(job: WorkEnvelope): { readonly callback?: PartnerCallback } {
  switch (job.type) {
    case 'payment.authorization.requested': {
      const input = AuthorizePaymentRequestSchema.parse(job.data)
      if (input.amountMinor % 100 === 99) return {}
      return {
        callback:
          input.amountMinor % 100 === 13 ? paymentAuthorizationFailed(job) : paymentAuthorized(job),
      }
    }
    case 'inventory.reservation.requested': {
      const input = ReserveInventoryRequestSchema.parse(job.data)
      if (input.lines.some((line) => line.sku === 'TIMEOUT')) return {}
      return {
        callback: input.lines.some((line) => line.sku === 'OOS')
          ? inventoryFailed(job)
          : inventoryReserved(job),
      }
    }
    case 'payment.capture.requested': {
      CapturePaymentRequestSchema.parse(job.data)
      return {
        callback: paymentCaptured(job),
      }
    }
    case 'shipping.requested': {
      const input = CreateShipmentRequestSchema.parse(job.data)
      if (input.address.postalCode === '99999') return {}
      return {
        callback:
          input.address.postalCode === '00000' ? shipmentFailed(job) : shipmentSucceeded(job),
      }
    }
    default:
      ReversalRequestSchema.parse(job.data)
      return {}
  }
}

function callbackBase(job: WorkEnvelope) {
  return {
    eventId: callbackId(job.eventId),
    occurredAt: new Date().toISOString(),
    tenantId: job.tenantId,
    orderId: job.orderId,
  }
}

function paymentAuthorized(job: WorkEnvelope): PartnerCallback {
  return {
    ...callbackBase(job),
    type: 'payment.authorization.succeeded',
    data: { authorizationId: resourceId('auth', job.eventId) },
  }
}

function paymentAuthorizationFailed(job: WorkEnvelope): PartnerCallback {
  return {
    ...callbackBase(job),
    type: 'payment.authorization.failed',
    data: { code: 'PAYMENT_DECLINED', reason: 'Card declined' },
  }
}

function inventoryReserved(job: WorkEnvelope): PartnerCallback {
  return {
    ...callbackBase(job),
    type: 'inventory.reservation.succeeded',
    data: { reservationId: resourceId('reservation', job.eventId) },
  }
}

function inventoryFailed(job: WorkEnvelope): PartnerCallback {
  return {
    ...callbackBase(job),
    type: 'inventory.reservation.failed',
    data: { code: 'OUT_OF_STOCK', reason: 'Item is out of stock' },
  }
}

function paymentCaptured(job: WorkEnvelope): PartnerCallback {
  return {
    ...callbackBase(job),
    type: 'payment.capture.succeeded',
    data: { captureId: resourceId('capture', job.eventId) },
  }
}

function shipmentSucceeded(job: WorkEnvelope): PartnerCallback {
  const trackingNumber = resourceId('track', job.eventId)
  return {
    ...callbackBase(job),
    type: 'shipping.shipment.succeeded',
    data: {
      shipmentId: resourceId('shipment', job.eventId),
      carrier: 'OpenParcel',
      trackingNumber,
      trackingUrl: `https://tracking.example/${trackingNumber}`,
    },
  }
}

function shipmentFailed(job: WorkEnvelope): PartnerCallback {
  return {
    ...callbackBase(job),
    type: 'shipping.shipment.failed',
    data: { code: 'BAD_ADDRESS', reason: 'Address was rejected' },
  }
}

function rejectForSimulation(job: WorkEnvelope, attempt: number): void {
  if (job.type !== 'inventory.reservation.requested') return
  const input = ReserveInventoryRequestSchema.parse(job.data)
  if (input.lines.some((line) => line.sku === 'DEAD-LETTER')) {
    throw new SimulatedPartnerUnavailableError('simulated permanent partner outage')
  }
  if (attempt <= 2 && input.lines.some((line) => line.sku === 'RETRY-TWICE')) {
    throw new SimulatedPartnerUnavailableError('simulated transient partner outage')
  }
}

function resourceId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

function callbackId(value: string): string {
  return resourceId('callback', value)
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}
