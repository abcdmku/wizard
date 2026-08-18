import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** Services used by the parent AND the child (a child flow receives its parent's deps). */
export interface Deps {
  payments: { charge(orderId: string, amount: number): { chargeId: string } }
  carrier: { ship(orderId: string, warehouse: 'east' | 'west'): Promise<{ tracking: string }> }
}

// ── child flow: fulfilment (view → task → final) ───────────────────────────────────────────

const f = defineFlow({
  name: 'fulfilment',
  // The parent's `context` mapper produces the INPUT side of this boundary; `warehouse` has a
  // default so the parent only has to provide the order id.
  context: z.object({
    orderId: z.string(),
    warehouse: z.enum(['east', 'west']).default('east'),
    tracking: z.string().optional(),
  }),
  deps: boundary.trusted<Deps>(), // same Deps: the parent's deps are handed down unchanged
})

export const fulfilment = f.steps(
  {
    pick: f.view({
      input: z.object({ warehouse: z.enum(['east', 'west']) }),
      exit: ({ output, update }) => update({ warehouse: output.warehouse }),
      next: 'ship',
    }),
    ship: f.task(
      async ({ context, deps, update }) => {
        const { tracking } = await deps.carrier.ship(context.orderId, context.warehouse)
        update({ tracking }) // the typed hand-off to the final step
        return { tracking }
      },
      { next: 'shipped' },
    ),
    // The child's output (`FlowOutput<typeof fulfilment>`) becomes the parent flow step's output.
    shipped: f.final({ output: ({ context }) => ({ tracking: context.tracking }) }),
  },
  { start: 'pick' },
)

// ── parent flow: order ────────────────────────────────────────────────────────────────────

const s = defineFlow({
  name: 'order',
  context: z.object({
    orderId: z.string(),
    amount: z.number().positive(),
    tracking: z.string().optional(),
  }),
  deps: boundary.trusted<Deps>(),
})

export const order = s.steps(
  {
    pay: s.task(({ context, deps }) => deps.payments.charge(context.orderId, context.amount), {
      next: 'fulfil',
    }),
    // The child runs as its own wizard instance (own queue, own snapshot under
    // `Snapshot.children.fulfil`); its events are forwarded with `path: ['fulfil']`.
    fulfil: s.flow(fulfilment, {
      context: ({ context }) => ({ orderId: context.orderId }),
      // `output` here is the child's typed output.
      exit: ({ output, update }) => update({ tracking: output.tracking }),
      next: 'receipt',
    }),
    receipt: s.final({
      output: ({ context }) => ({ orderId: context.orderId, tracking: context.tracking }),
    }),
  },
  { start: 'pay' },
)
