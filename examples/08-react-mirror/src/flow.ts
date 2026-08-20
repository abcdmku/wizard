/**
 * The checkout flow. This is SERVER code: in production this module (and everything it
 * imports) runs on the server; the client only ever imports the TYPE of `checkoutClient`
 * (see client.ts).
 *
 * view `shipping` → view `payment` → task `reserve` → task `charge` → final `receipt`
 */
import { boundary, defineFlow, defineProjection } from '@openwizard/core'
import { z } from 'zod'

/**
 * Services outside the flow that the tasks call. Injected through `deps` (no globals in
 * hooks). Note there is no `tokenize` here: the card number is tokenised in the BROWSER by the
 * payment provider's SDK (`payments.ts` fakes it), so the run, the server, the snapshots
 * and every frame only ever see the opaque token.
 */
export interface CheckoutDeps {
  inventory: { reserve(cartId: string): Promise<{ reservationId: string }> }
  payments: { charge(token: string, amount: number): Promise<{ chargeId: string }> }
}

const checkout = defineFlow({
  name: 'checkout',
  version: 1,
  context: z.object({
    cartId: z.string(),
    total: z.number().positive(),
    express: z.boolean().default(false),
    customer: z.string().optional(),
    /** Opaque token from the payment view; the card number never enters the run at all. */
    paymentToken: z.string().optional(),
    reservationId: z.string().optional(),
    chargeId: z.string().optional(),
  }),
  deps: boundary.trusted<CheckoutDeps>(), // trusted: constructed by the server, never from the wire
  onFailure: 'compensate',
})

export const checkoutFlow = checkout.steps(
  {
    shipping: checkout.view({
      label: 'Shipping',
      input: z.object({
        name: z.string().min(2, 'Name needs at least 2 characters'),
        address: z.string().min(5, 'Address needs at least 5 characters'),
        express: z.boolean().default(false),
      }),
      initial: { name: '', address: '' }, // draft (INPUT side) the client starts from
      exit: ({ output, update }) => update({ customer: output.name, express: output.express }),
      next: 'payment',
    }),
    payment: checkout.view({
      label: 'Payment',
      // The draft holds the provider's token (+ last4 for display), never the card number: the
      // UI tokenises with the provider SDK BEFORE `setInput` (see App.tsx / payments.ts).
      input: z.object({
        paymentToken: z.string().regex(/^tok_/, 'Tokenise the card first'),
        last4: z.string().regex(/^\d{4}$/),
      }),
      exit: ({ output, update }) => update({ paymentToken: output.paymentToken }),
      next: 'reserve',
    }),
    reserve: checkout.task(({ context, deps }) => deps.inventory.reserve(context.cartId), {
      label: 'Reserve stock',
      // `attempts` = retries after the first failure: one retry here, 400 ms later.
      retry: { attempts: 1, backoff: 400 },
      exit: ({ output, update }) => update({ reservationId: output.reservationId }),
      compensate: () => {
        /* release the reservation in a real system */
      },
      next: 'charge',
    }),
    charge: checkout.task(
      ({ context, deps }) => deps.payments.charge(context.paymentToken ?? '', context.total),
      {
        label: 'Charge card',
        exit: ({ output, update }) => update({ chargeId: output.chargeId }),
        next: 'receipt',
      },
    ),
    receipt: checkout.final({
      label: 'Receipt',
      output: ({ context }) => ({
        customer: context.customer ?? '',
        total: context.total,
        express: context.express,
        reservationId: context.reservationId ?? '',
        chargeId: context.chargeId ?? '',
      }),
    }),
  },
  { start: 'shipping' },
)

/**
 * Deny-by-default projection = the client's whole view of the run. Only what is listed
 * crosses the wire: the two view drafts (the payment draft is a token + last4) and their
 * validation issues, the two tasks' sanitized errors, two context fields and the flow output
 * (the receipt). `cartId`, `reservationId`, `chargeId` and the task outputs never do. Base
 * facts (`id` / `kind` / `status` / `phase` / `attempt` per step, `current`, `status`) always do.
 */
export const checkoutClient = defineProjection(checkoutFlow, {
  expose: {
    steps: {
      shipping: { input: true, issues: true },
      payment: { input: true, issues: true },
      reserve: { error: true },
      charge: { error: true },
    },
    context: ['total', 'express'],
    output: true,
  },
})
