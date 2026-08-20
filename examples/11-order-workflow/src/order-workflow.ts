import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** The facts known when an order run starts, plus shipment details collected later. */
const OrderContext = z.object({
  orderId: z.string().min(1),
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  total: z.number().positive(),
  shipmentId: z.string().optional(),
  trackingUrl: z.url().optional(),
})

export type OrderContext = z.infer<typeof OrderContext>
export type OrderLine = OrderContext['lines'][number]

/** Services stay outside the flow and are supplied by the host at `createRun` time. */
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

/** JSON-safe data recorded on a charge failure, separate from the raw error message. */
export interface ChargeFailure {
  code: 'PAYMENT_UNAVAILABLE' | 'DECLINED'
  attempt: number
}

const orderWorkflow = defineFlow({
  name: 'order-workflow',
  version: 1,
  context: OrderContext,
  deps: boundary.trusted<Deps>(), // the host constructs these services; core does not inspect them
  events: {
    // Webhook payloads are untrusted and are parsed before a handler sees them.
    'shipment.ready': z.object({
      orderId: z.string(),
      shipmentId: z.string(),
      trackingUrl: z.url(),
    }),
  },
  // A webhook for a different order is dropped instead of being buffered on this run.
  correlate: { 'shipment.ready': (payload) => payload.orderId },
  // A failed downstream task means the order should not keep a reservation or a charge.
  onFailure: 'compensate',
})

export const orderWorkflowFlow = orderWorkflow.steps(
  {
    reserve: orderWorkflow.task(
      ({ context, deps, idempotencyKey }) =>
        deps.inventory.reserve(context.orderId, context.lines, { idempotencyKey }),
      {
        idempotent: ({ context }) => `order:${context.orderId}:inventory-reserve`,
        // Releasing inventory is useful only after a later task fails; a normal shipment keeps it.
        compensate: ({ context, deps, output }) =>
          deps.inventory.release(output.reservationId, {
            idempotencyKey: `order:${context.orderId}:inventory-release`,
          }),
        next: 'charge',
      },
    ),
    charge: orderWorkflow.task(
      ({ context, deps, idempotencyKey }) =>
        deps.payments.charge(context.orderId, context.total, { idempotencyKey }),
      {
        // Retry deadlines are part of the run state and are re-armed from a snapshot on resume.
        retry: { attempts: 3, backoff: 'exponential' },
        idempotent: ({ context }) => `order:${context.orderId}:payment-charge`,
        mapError: (error, { attempt }): ChargeFailure => ({
          code:
            error instanceof Error && /unavailable|timeout/i.test(error.message)
              ? 'PAYMENT_UNAVAILABLE'
              : 'DECLINED',
          attempt,
        }),
        // If fulfilment cannot accept an already-paid order, refund that exact payment once.
        compensate: ({ context, deps, output }) =>
          deps.payments.refund(output.paymentId, {
            idempotencyKey: `order:${context.orderId}:payment-refund`,
          }),
        next: 'requestShipment',
      },
    ),
    requestShipment: orderWorkflow.task(
      ({ context, deps, idempotencyKey }) =>
        deps.fulfilment.request(context.orderId, { idempotencyKey }),
      {
        idempotent: ({ context }) => `order:${context.orderId}:fulfilment-request`,
        next: 'awaitShipment',
      },
    ),
    awaitShipment: orderWorkflow.wait({
      on: {
        // The parsed event updates only the typed context; the final step reads those facts.
        'shipment.ready': ({ payload, update }) => {
          update({ shipmentId: payload.shipmentId, trackingUrl: payload.trackingUrl })
        },
      },
      // A missing webhook is an operational pending state, not a reason to refund automatically.
      timeout: { after: '24h', next: 'shipmentPending' },
      next: 'shipped',
    }),
    shipped: orderWorkflow.final({
      output: ({ context }) =>
        `order ${context.orderId} shipped (${context.shipmentId}; ${context.trackingUrl})`,
    }),
    shipmentPending: orderWorkflow.final({
      output: ({ context }) => `order ${context.orderId} paid; shipment is still pending`,
    }),
  },
  { start: 'reserve' },
)
