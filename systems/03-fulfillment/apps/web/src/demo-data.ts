import {
  type CustomerOrder,
  CustomerOrderSchema,
  type OperatorOrder,
  OperatorOrderListResponseSchema,
} from './contracts'

export const catalog = [
  { sku: 'FIELD-NOTE-01', name: 'Field Notes Set', unitPriceMinor: 2400 },
  { sku: 'TRAVEL-MUG-02', name: 'Vacuum Travel Mug', unitPriceMinor: 3800 },
  { sku: 'PACK-CUBE-03', name: 'Packing Cube Pair', unitPriceMinor: 3200 },
  { sku: 'CABLE-KIT-04', name: 'Everyday Cable Kit', unitPriceMinor: 4600 },
]

const address = {
  recipient: 'Alice Adams',
  line1: '212 W Lake Street',
  city: 'Chicago',
  region: 'IL',
  postalCode: '60606',
  country: 'US',
}

const seedOrders = OperatorOrderListResponseSchema.parse({
  orders: [
    {
      id: '3f7680a0-f562-47df-913e-6e0e688388d8',
      status: 'shipping',
      currency: 'USD',
      totalMinor: 10800,
      lines: [
        { sku: 'TRAVEL-MUG-02', name: 'Vacuum Travel Mug', quantity: 2, unitPriceMinor: 3800 },
        { sku: 'PACK-CUBE-03', name: 'Packing Cube Pair', quantity: 1, unitPriceMinor: 3200 },
      ],
      createdAt: '2026-08-23T15:42:00.000Z',
      updatedAt: '2026-08-23T15:44:31.000Z',
      tenantId: 'tenant-demo',
      customerId: 'demo-customer',
      shippingAddress: address,
      partnerState: {
        paymentAuthorization: { state: 'succeeded', id: 'pay_auth_1048' },
        inventoryReservation: { state: 'succeeded', id: 'inventory_rsv_1048' },
        paymentCapture: { state: 'succeeded', id: 'pay_cap_1048' },
        shipment: { state: 'waiting', requestId: 'ship_req_1048' },
      },
      fraud: { state: 'approved', reviewerId: 'rules-engine' },
      workflow: {
        status: 'running',
        current: 'wait-for-shipment',
        seq: 18,
        bufferedCallbacks: 0,
        deadLetter: false,
        steps: [
          { id: 'authorize-payment', status: 'done', phase: 'complete', attempt: 1 },
          { id: 'reserve-inventory', status: 'done', phase: 'complete', attempt: 1 },
          { id: 'fraud-review', status: 'done', phase: 'complete', attempt: 1 },
          { id: 'create-shipment', status: 'active', phase: 'waiting', attempt: 1 },
        ],
      },
    },
    {
      id: 'c6f3e4f4-40fc-4311-a215-8f1aa6dd25b2',
      status: 'fraud_review',
      currency: 'USD',
      totalMinor: 11600,
      lines: [
        { sku: 'CABLE-KIT-04', name: 'Everyday Cable Kit', quantity: 2, unitPriceMinor: 4600 },
        { sku: 'FIELD-NOTE-01', name: 'Field Notes Set', quantity: 1, unitPriceMinor: 2400 },
      ],
      createdAt: '2026-08-23T15:37:00.000Z',
      updatedAt: '2026-08-23T15:38:12.000Z',
      tenantId: 'tenant-demo',
      customerId: 'demo-customer',
      shippingAddress: address,
      partnerState: {
        paymentAuthorization: { state: 'succeeded', id: 'pay_auth_1047' },
        inventoryReservation: { state: 'succeeded', id: 'inventory_rsv_1047' },
        paymentCapture: { state: 'not_started' },
        shipment: { state: 'not_started' },
      },
      fraud: { state: 'manual_review', note: 'Billing distance and order velocity' },
      workflow: {
        status: 'waiting',
        current: 'fraud-review',
        seq: 11,
        bufferedCallbacks: 0,
        deadLetter: false,
        steps: [
          { id: 'authorize-payment', status: 'done', phase: 'complete', attempt: 1 },
          { id: 'reserve-inventory', status: 'done', phase: 'complete', attempt: 2 },
          { id: 'fraud-review', status: 'active', phase: 'waiting', attempt: 1 },
          { id: 'create-shipment', status: 'idle', attempt: 0 },
        ],
      },
    },
    {
      id: 'f798a8de-e60e-45af-8b1b-806cb62e5a32',
      status: 'failed',
      currency: 'USD',
      totalMinor: 7600,
      lines: [
        { sku: 'TRAVEL-MUG-02', name: 'Vacuum Travel Mug', quantity: 2, unitPriceMinor: 3800 },
      ],
      createdAt: '2026-08-23T14:56:00.000Z',
      updatedAt: '2026-08-23T15:06:48.000Z',
      issue: {
        code: 'INVENTORY_TIMEOUT',
        message: 'Inventory reservation failed. The payment authorization was released.',
      },
      tenantId: 'tenant-demo',
      customerId: 'demo-customer',
      shippingAddress: address,
      partnerState: {
        paymentAuthorization: { state: 'reversed', id: 'pay_auth_1042' },
        inventoryReservation: { state: 'failed' },
        paymentCapture: { state: 'not_started' },
        shipment: { state: 'not_started' },
      },
      fraud: { state: 'cancelled' },
      workflow: {
        status: 'failed',
        current: null,
        seq: 24,
        bufferedCallbacks: 0,
        deadLetter: true,
        steps: [
          { id: 'authorize-payment', status: 'done', phase: 'complete', attempt: 1 },
          {
            id: 'reserve-inventory',
            status: 'failed',
            phase: 'failed',
            attempt: 3,
            error: { code: 'INVENTORY_TIMEOUT', message: 'Warehouse reservation timed out' },
          },
          { id: 'reverse-payment', status: 'done', phase: 'complete', attempt: 1 },
        ],
      },
    },
    {
      id: 'f26bc8e7-6a32-4e93-a9f7-7066f28dbbcb',
      status: 'cancelling',
      currency: 'USD',
      totalMinor: 7000,
      lines: [
        { sku: 'PACK-CUBE-03', name: 'Packing Cube Pair', quantity: 1, unitPriceMinor: 3200 },
        { sku: 'TRAVEL-MUG-02', name: 'Vacuum Travel Mug', quantity: 1, unitPriceMinor: 3800 },
      ],
      createdAt: '2026-08-23T14:22:00.000Z',
      updatedAt: '2026-08-23T14:31:05.000Z',
      tenantId: 'tenant-demo',
      customerId: 'demo-customer',
      shippingAddress: address,
      partnerState: {
        paymentAuthorization: { state: 'failed' },
        inventoryReservation: { state: 'releasing', id: 'inventory_rsv_1039' },
        paymentCapture: { state: 'not_started' },
        shipment: { state: 'not_started' },
      },
      fraud: { state: 'cancelled' },
      workflow: {
        status: 'compensating',
        current: 'release-inventory',
        seq: 21,
        bufferedCallbacks: 1,
        deadLetter: false,
        steps: [
          {
            id: 'authorize-payment',
            status: 'failed',
            phase: 'failed',
            attempt: 2,
            error: { code: 'PAYMENT_DECLINED', message: 'Payment provider declined the charge' },
          },
          { id: 'reserve-inventory', status: 'done', phase: 'complete', attempt: 1 },
          {
            id: 'release-inventory',
            status: 'active',
            phase: 'compensating',
            attempt: 2,
            error: { code: 'WAREHOUSE_503', message: 'Warehouse API returned 503' },
          },
        ],
      },
    },
  ],
}).orders

export function toCustomerOrder(order: OperatorOrder): CustomerOrder {
  return CustomerOrderSchema.parse({
    id: order.id,
    status: order.status,
    currency: order.currency,
    totalMinor: order.totalMinor,
    lines: order.lines,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    shipment: order.shipment,
    issue: order.issue,
  })
}

export function freshDemoOrders(): OperatorOrder[] {
  return OperatorOrderListResponseSchema.parse({ orders: seedOrders }).orders
}
