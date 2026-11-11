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

/** Views, fan-out, a timeout, a control join, declared routing and a nested wizard. */
export const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    context: z.object({ cartId: z.string(), paymentId: z.string().optional() }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, view, flow, steps }) =>
    steps(
      {
        shipping: view({ input: z.object({ address: z.string().min(1) }), next: 'reserve' }),
        reserve: step({
          run: ({ context, deps }) => deps.inventory.reserve(context.cartId),
          next: ['awaitPayment', 'audit'],
        }),
        audit: step({ run: async () => ({ audited: true }), next: 'route' }),
        awaitPayment: step({
          waitFor: {
            'payment.captured': ({ payload, update }) => {
              update({ paymentId: payload.paymentId })
              return { done: payload }
            },
          },
          timeout: { after: '15m', next: 'expired' },
          next: 'route',
        }),
        route: step({
          // dependsOn gates a pushed activation; needs would also supply typed data.
          dependsOn: ['awaitPayment', 'audit'],
          targets: ['fulfil', 'declined'],
          next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined'),
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
    ),
)
