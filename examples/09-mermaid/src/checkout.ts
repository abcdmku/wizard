import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

/** Services outside the wizard that tasks call through deps. */
export interface Deps {
  inventory: { reserve(cartId: string): Promise<{ reservationId: string }> }
  shipping: { createLabel(orderId: string): Promise<{ trackingId: string }> }
}

export const fulfilmentFlow = defineWizard(
  {
    name: 'fulfilment',
    context: z.object({ orderId: z.string(), trackingId: z.string().optional() }),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, steps }) =>
    steps({
      label: step({
        run: ({ context, deps }) => deps.shipping.createLabel(context.orderId),
        exit: ({ output, update }) => update({ trackingId: output.trackingId }),
        next: 'done',
      }),
      done: step({ run: ({ context }) => ({ trackingId: context.trackingId }) }),
    }),
)

/** Views, fan-out, a timeout, a join, declared routing and a nested wizard. */
export const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    context: z.object({ cartId: z.string(), paymentId: z.string().optional() }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, view, flow, steps }) => {
    const audit = step({ run: async () => ({ audited: true }) })
    const awaitPayment = step({
      waitFor: {
        'payment.captured': ({ payload, update }) => {
          update({ paymentId: payload.paymentId })
          return { done: payload }
        },
      },
      timeout: { after: '15m', next: 'expired' },
    })
    return steps(
      {
        shipping: view({ input: z.object({ address: z.string().min(1) }), next: 'reserve' }),
        reserve: step({
          run: ({ context, deps }) => deps.inventory.reserve(context.cartId),
          next: ['awaitPayment', 'audit'],
        }),
        audit,
        awaitPayment,
        route: step({
          // The route waits for both branches. The optional need lets it run after the payment
          // wait times out, when there is no payment to read.
          needs: { audit, payment: { optional: awaitPayment } },
          targets: ['fulfil', 'declined'],
          next: ({ needs }) => (needs.payment ? 'fulfil' : 'declined'),
        }),
        fulfil: flow(fulfilmentFlow, {
          context: ({ context }) => ({ orderId: context.cartId }),
          next: 'receipt',
        }),
        receipt: step({ run: () => undefined }),
        declined: step({ run: () => undefined }),
        expired: step({ run: () => undefined }),
      },
      { start: 'shipping' },
    )
  },
)
