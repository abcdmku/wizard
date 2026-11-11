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
    description: 'Creates a shipping label and returns its tracking id.',
    context: z.object({ orderId: z.string() }),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, steps }) => {
    const label = step({
      run: ({ context, deps }) => deps.shipping.createLabel(context.orderId),
    })
    const done = step({
      needs: { label },
      run: ({ needs }) => ({ trackingId: needs.label.trackingId }),
    })
    return steps({ label, done })
  },
)

/** Views, fan-out, a timeout, a join, declared routing and a nested wizard. */
export const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    description: 'Reserves stock, waits for payment while an audit runs, then fulfils or declines.',
    context: z.object({ cartId: z.string() }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, view, flow, steps }) => {
    const audit = step({ run: async () => ({ audited: true }) })
    const awaitPayment = step({
      waitFor: { 'payment.captured': ({ payload }) => ({ done: payload }) },
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
