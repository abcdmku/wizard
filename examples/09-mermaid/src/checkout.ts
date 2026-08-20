import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** Services outside the flow that the tasks call (injected through `deps`). */
export interface Deps {
  inventory: { reserve(cartId: string): Promise<{ reservationId: string }> }
  shipping: { createLabel(orderId: string): Promise<{ trackingId: string }> }
}

// ── child flow: fulfilment ────────────────────────────────────────────────────────────────

const fulfilment = defineFlow({
  name: 'fulfilment',
  context: z.object({ orderId: z.string(), trackingId: z.string().optional() }),
  deps: boundary.trusted<Deps>(),
})
export const fulfilmentFlow = fulfilment.steps({
  label: fulfilment.task(({ context, deps }) => deps.shipping.createLabel(context.orderId), {
    exit: ({ output, update }) => update({ trackingId: output.trackingId }),
    next: 'done',
  }),
  done: fulfilment.final({ output: ({ context }) => ({ trackingId: context.trackingId }) }),
})

// ── root flow: checkout ───────────────────────────────────────────────────────────────────

const checkout = defineFlow({
  name: 'checkout',
  context: z.object({ cartId: z.string(), paymentId: z.string().optional() }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(),
})

/**
 * Every static feature of a graph in one flow: a view, a fan-out `next`, a wait with a timeout
 * edge, a decision with a dynamic `next` (the graph cannot know its targets), an AND-join
 * (`dependsOn`), a nested flow and three finals.
 */
export const checkoutFlow = checkout.steps(
  {
    shipping: checkout.view({ input: z.object({ address: z.string().min(1) }), next: 'reserve' }),
    reserve: checkout.task(({ context, deps }) => deps.inventory.reserve(context.cartId), {
      next: ['awaitPayment', 'audit'],
    }),
    audit: checkout.task(async () => ({ audited: true }), { next: 'route' }),
    awaitPayment: checkout.wait({
      on: { 'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }) },
      timeout: { after: '15m', next: 'expired' },
      next: 'route',
    }),
    route: checkout.decision({
      dependsOn: ['awaitPayment', 'audit'],
      next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined'),
    }),
    fulfil: checkout.flow(fulfilmentFlow, {
      context: ({ context }) => ({ orderId: context.cartId }),
      next: 'receipt',
    }),
    receipt: checkout.final(),
    declined: checkout.final(),
    expired: checkout.final(),
  },
  { start: 'shipping' },
)
