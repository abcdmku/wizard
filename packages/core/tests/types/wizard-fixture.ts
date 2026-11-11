import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineWizard } from '../../src/wizard/define-wizard'

export interface CheckoutDeps {
  inventory: {
    reserve(cartId: string, opts: { signal: AbortSignal }): Promise<{ reservationId: string }>
  }
}

export const grandchildFlow = defineWizard(
  { name: 'grandchild', context: z.object({ sku: z.string() }) },
  ({ view, step, steps }) =>
    steps({
      pick: view({ input: z.object({ bin: z.string() }), next: 'done' }),
      done: step({}),
    }),
)

export const fulfilmentFlow = defineWizard(
  { name: 'fulfilment', context: z.object({ orderId: z.string() }) },
  ({ step, view, child, steps }) =>
    steps({
      label: step({ run: async () => ({ trackingId: 'x' }), next: 'confirm' }),
      confirm: view({ input: z.object({ ok: z.boolean() }), next: 'pack' }),
      pack: child(grandchildFlow, { context: () => ({ sku: 's' }), next: 'done' }),
      done: step({ run: () => ({ trackingId: 'x' }) }),
    }),
)

export const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    context: z.object({
      cartId: z.string(),
      total: z.number(),
      express: z.boolean().default(false),
    }),
    events: {
      'payment.captured': z.object({ paymentId: z.string() }),
      'payment.failed': z.object({ reason: z.string() }),
    },
    deps: boundary.trusted<CheckoutDeps>(),
  },
  ({ view, step, child, steps }) =>
    steps(
      {
        shipping: view({
          input: z.object({ address: z.string(), express: z.boolean().default(false) }),
          next: 'reserve',
        }),
        reserve: step({
          run: ({ context, deps, signal }) => deps.inventory.reserve(context.cartId, { signal }),
          next: 'awaitPayment',
        }),
        awaitPayment: step({ waitFor: { 'payment.captured': () => {} }, next: 'fulfil' }),
        fulfil: child(fulfilmentFlow, {
          context: ({ context }) => ({ orderId: context.cartId }),
          next: 'receipt',
        }),
        receipt: step({}),
      },
      { start: 'shipping' },
    ),
)

export type CheckoutF = typeof checkoutFlow
