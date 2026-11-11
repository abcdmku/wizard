import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

/** Order facts known at creation, plus shipment details collected later. */
const OrderContext = z.object({
  orderId: z.string().min(1),
  lines: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
  total: z.number().positive(),
  shipmentId: z.string().optional(),
  trackingUrl: z.url().optional(),
})

export type OrderContext = z.infer<typeof OrderContext>
export type OrderLine = OrderContext['lines'][number]

/** The host supplies these services when it calls orderWorkflowFlow.create(input, { deps }). */
export interface Deps {
  inventory: {
    reserve(
      orderId: string,
      lines: readonly OrderLine[],
      options: { readonly idempotencyKey: string },
    ): Promise<{ reservationId: string }>
    release(reservationId: string, options: { readonly idempotencyKey: string }): Promise<void>
  }
  payments: {
    charge(
      orderId: string,
      amount: number,
      options: { readonly idempotencyKey: string },
    ): Promise<{ paymentId: string }>
    refund(paymentId: string, options: { readonly idempotencyKey: string }): Promise<void>
  }
  fulfilment: {
    request(
      orderId: string,
      options: { readonly idempotencyKey: string },
    ): Promise<{ requestId: string }>
  }
}

/** JSON-safe charge failure data retained alongside the original error message. */
export type ChargeFailure = {
  code: 'PAYMENT_UNAVAILABLE' | 'DECLINED'
  attempt: number
}

export const orderWorkflowFlow = defineWizard(
  {
    name: 'order-workflow',
    version: 1,
    context: OrderContext,
    deps: boundary.trusted<Deps>(),
    events: {
      // Untrusted webhook payloads are parsed before the wait handler sees them.
      'shipment.ready': z.object({
        orderId: z.string(),
        shipmentId: z.string(),
        trackingUrl: z.url(),
      }),
    },
    correlate: { 'shipment.ready': (payload) => payload.orderId },
    onFailure: 'compensate',
  },
  ({ step, steps }) =>
    steps(
      {
        reserve: step({
          run: ({ context, deps, idempotencyKey }) =>
            deps.inventory.reserve(context.orderId, context.lines, { idempotencyKey }),
          idempotent: ({ context }) => `order:${context.orderId}:inventory-reserve`,
          compensate: ({ context, deps, output }) =>
            deps.inventory.release(output.reservationId, {
              idempotencyKey: `order:${context.orderId}:inventory-release`,
            }),
          next: 'charge',
        }),
        charge: step({
          run: ({ context, deps, idempotencyKey }) =>
            deps.payments.charge(context.orderId, context.total, { idempotencyKey }),
          mapError: (error, { attempt }): ChargeFailure => ({
            code:
              error instanceof Error && /unavailable|timeout/i.test(error.message)
                ? 'PAYMENT_UNAVAILABLE'
                : 'DECLINED',
            attempt,
          }),
          // Retry deadlines and the mapped error survive a restart. A declined payment is final.
          retry: {
            retries: 3,
            backoff: 'exponential',
            when: (error) => error.code === 'PAYMENT_UNAVAILABLE',
          },
          idempotent: ({ context }) => `order:${context.orderId}:payment-charge`,
          compensate: ({ context, deps, output }) =>
            deps.payments.refund(output.paymentId, {
              idempotencyKey: `order:${context.orderId}:payment-refund`,
            }),
          next: 'requestShipment',
        }),
        requestShipment: step({
          run: ({ context, deps, idempotencyKey }) =>
            deps.fulfilment.request(context.orderId, { idempotencyKey }),
          idempotent: ({ context }) => `order:${context.orderId}:fulfilment-request`,
          next: 'awaitShipment',
        }),
        awaitShipment: step({
          waitFor: {
            'shipment.ready': ({ payload, update }) => {
              update({ shipmentId: payload.shipmentId, trackingUrl: payload.trackingUrl })
              return { done: payload }
            },
          },
          // A missing webhook leaves a paid order pending instead of refunding it automatically.
          timeout: { after: '24h', next: 'shipmentPending' },
          next: 'shipped',
        }),
        shipped: step({
          run: ({ context }) =>
            `order ${context.orderId} shipped (${context.shipmentId}; ${context.trackingUrl})`,
        }),
        shipmentPending: step({
          run: ({ context }) => `order ${context.orderId} paid; shipment is still pending`,
        }),
      },
      { start: 'reserve' },
    ),
)
