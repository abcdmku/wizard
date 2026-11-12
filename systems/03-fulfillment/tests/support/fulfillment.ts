import type { PartnerAccepted, PartnerCallback } from '@fulfillment/contracts'
import {
  type FulfillmentContext,
  type FulfillmentDependencies,
  fulfillmentWizard,
  type PartnerGateway,
} from '@fulfillment/domain'
import type { Run, Store } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'

export const ORDER_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538'
export const OTHER_ORDER_ID = '9b2a58e0-70a3-47fb-a81f-e4de3c30f6db'
export const TENANT_ID = 'tenant-acme'
export const NOW = '2026-08-23T15:00:00.000Z'

type CallbackOf<T extends PartnerCallback['type']> = Extract<PartnerCallback, { type: T }>
export type PaymentAuthorizedCallback = CallbackOf<'payment.authorization.succeeded'>
export type InventoryReservedCallback = CallbackOf<'inventory.reservation.succeeded'>
export type PaymentCapturedCallback = CallbackOf<'payment.capture.succeeded'>
export type ShipmentSucceededCallback = CallbackOf<'shipping.shipment.succeeded'>

function accepted(requestId: string): PartnerAccepted {
  return { accepted: true, requestId, duplicate: false }
}

export function createGateway(
  calls: string[],
  options: { readonly captureFails?: boolean } = {},
): PartnerGateway {
  return {
    authorizePayment: async ({ idempotencyKey }) => {
      calls.push(`authorize:${idempotencyKey}`)
      return accepted('payment-request-1')
    },
    reserveInventory: async ({ idempotencyKey }) => {
      calls.push(`reserve:${idempotencyKey}`)
      return accepted('inventory-request-1')
    },
    capturePayment: async ({ idempotencyKey }) => {
      calls.push(`capture:${idempotencyKey}`)
      if (options.captureFails === true) throw new Error('capture unavailable')
      return accepted('capture-request-1')
    },
    createShipment: async ({ idempotencyKey }) => {
      calls.push(`shipment:${idempotencyKey}`)
      return accepted('shipment-request-1')
    },
    voidAuthorization: async ({ resourceId, idempotencyKey }) => {
      calls.push(`void:${resourceId}:${idempotencyKey}`)
    },
    releaseInventory: async ({ resourceId, idempotencyKey }) => {
      calls.push(`release:${resourceId}:${idempotencyKey}`)
    },
    refundPayment: async ({ resourceId, idempotencyKey }) => {
      calls.push(`refund:${resourceId}:${idempotencyKey}`)
    },
    cancelShipment: async ({ resourceId, idempotencyKey }) => {
      calls.push(`cancel-shipment:${resourceId}:${idempotencyKey}`)
    },
  }
}

export function context(): FulfillmentContext {
  return {
    orderId: ORDER_ID,
    tenantId: TENANT_ID,
    customerId: 'customer-alice',
    currency: 'USD',
    totalMinor: 4200,
    lines: [{ sku: 'sku-1', name: 'Notebook', quantity: 1, unitPriceMinor: 4200 }],
    shippingAddress: {
      recipient: 'Jordan Lee',
      line1: '1 Main Street',
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      country: 'US',
    },
    callbackUrl: 'https://orchestrator.test/api/webhooks/partner',
    createdAt: NOW,
    updatedAt: NOW,
    paymentAuthorization: { state: 'pending' },
    inventoryReservation: { state: 'pending' },
    paymentCapture: { state: 'idle' },
    fraud: { state: 'pending' },
    shipment: { state: 'idle' },
  }
}

export function makeRun(
  calls: string[],
  options: {
    readonly captureFails?: boolean
    readonly store?: Store
    readonly key?: string
    readonly instanceId?: string
    readonly scheduler?: TestScheduler
  } = {},
): Run<typeof fulfillmentWizard> {
  const dependencies: FulfillmentDependencies = {
    gateway: createGateway(calls, options),
    now: () => NOW,
  }
  return fulfillmentWizard.create(context(), {
    deps: dependencies,
    scheduler: options.scheduler ?? createTestScheduler({ now: Date.parse(NOW) }),
    ...(options.store === undefined ? {} : { store: options.store }),
    ...(options.key === undefined ? {} : { key: options.key }),
    instanceId: options.instanceId ?? 'run-order-1',
    correlationId: ORDER_ID,
  })
}

export function paymentAuthorized(orderId = ORDER_ID): PaymentAuthorizedCallback {
  return {
    type: 'payment.authorization.succeeded',
    eventId: `evt-payment-${orderId}`,
    occurredAt: NOW,
    tenantId: TENANT_ID,
    orderId,
    data: { authorizationId: 'auth-1' },
  }
}

export function inventoryReserved(orderId = ORDER_ID): InventoryReservedCallback {
  return {
    type: 'inventory.reservation.succeeded',
    eventId: `evt-inventory-${orderId}`,
    occurredAt: NOW,
    tenantId: TENANT_ID,
    orderId,
    data: { reservationId: 'reservation-1' },
  }
}

export function fraud(decision: 'approve' | 'reject') {
  return { orderId: ORDER_ID, decision, reviewerId: 'operator-1', decidedAt: NOW }
}

export function paymentCaptured(): PaymentCapturedCallback {
  return {
    type: 'payment.capture.succeeded',
    eventId: 'evt-capture-1',
    occurredAt: NOW,
    tenantId: TENANT_ID,
    orderId: ORDER_ID,
    data: { captureId: 'capture-1' },
  }
}

export function shipmentSucceeded(): ShipmentSucceededCallback {
  return {
    type: 'shipping.shipment.succeeded',
    eventId: 'evt-shipment-1',
    occurredAt: NOW,
    tenantId: TENANT_ID,
    orderId: ORDER_ID,
    data: {
      shipmentId: 'shipment-1',
      carrier: 'ParcelPost',
      trackingNumber: 'TRACK-1',
      trackingUrl: 'https://carrier.test/track/TRACK-1',
    },
  }
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

export async function startThroughFraud(run: Run<typeof fulfillmentWizard>): Promise<void> {
  await run.start()
  await flush()
  await run.send('payment.authorization.succeeded', paymentAuthorized())
  await run.send('inventory.reservation.succeeded', inventoryReserved())
  await flush()
}
