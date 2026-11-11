/**
 * The checkout flow. This is SERVER code: in production this module (and everything it
 * imports) runs on the server; the client only ever imports the TYPE of `checkoutClient`
 * (see client.ts).
 *
 * view `shipping` → view `payment` → step `reserve` → step `charge` → step `receipt`
 */
import { boundary, defineProjection, defineWizard } from '@openwizard/core'
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

export const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    description: 'Collects shipping and payment, reserves stock, charges, and returns a receipt.',
    version: 1,
    context: z.object({
      cartId: z.string(),
      total: z.number().positive(),
      /** The client reads this through the projection, so the shipping view keeps it current. */
      express: z.boolean().default(false),
    }),
    deps: boundary.trusted<CheckoutDeps>(), // trusted: constructed by the server, never from the wire
    onFailure: 'compensate',
  },
  ({ step, view, steps }) => {
    const shipping = view({
      label: 'Shipping',
      input: z.object({
        name: z.string().min(2, 'Name needs at least 2 characters'),
        address: z.string().min(5, 'Address needs at least 5 characters'),
        express: z.boolean().default(false),
      }),
      initial: { name: '', address: '' }, // draft (INPUT side) the client starts from
      exit: ({ output, update }) => update({ express: output.express }),
      next: 'payment',
    })
    const payment = view({
      label: 'Payment',
      // The draft holds the provider's token (+ last4 for display), never the card number: the
      // UI tokenises with the provider SDK BEFORE `setInput` (see App.tsx / payments.ts).
      input: z.object({
        paymentToken: z.string().regex(/^tok_/, 'Tokenise the card first'),
        last4: z.string().regex(/^\d{4}$/),
      }),
      next: 'reserve',
    })
    const reserve = step({
      run: ({ context, deps }) => deps.inventory.reserve(context.cartId),
      label: 'Reserve stock',
      // One retry, 400 ms after the first failure.
      retry: { retries: 1, backoff: 400 },
      compensate: () => {
        /* release the reservation in a real system */
      },
    })
    const charge = step({
      description: 'Charges the token from the payment view once the stock is reserved.',
      // The reserve need holds the charge back. The payment need supplies the token, typed.
      needs: { payment, reserve },
      run: ({ context, deps, needs }) =>
        deps.payments.charge(needs.payment.paymentToken, context.total),
      label: 'Charge card',
    })
    const receipt = step({
      description: 'Joins the earlier outputs into the receipt, which is the wizard output.',
      needs: { shipping, reserve, charge },
      run: ({ context, needs }) => ({
        customer: needs.shipping.name,
        total: context.total,
        express: needs.shipping.express,
        reservationId: needs.reserve.reservationId,
        chargeId: needs.charge.chargeId,
      }),
    })
    return steps({ shipping, payment, reserve, charge, receipt }, { start: 'shipping' })
  },
)

/**
 * Deny-by-default projection = the client's whole view of the run. Only what is listed
 * crosses the wire: the two view drafts (the payment draft is a token + last4) and their
 * validation issues, the two tasks' sanitized errors, two context fields and the flow output
 * (the receipt). `cartId` and the step outputs never do. Base facts (`id` / `kind` / `status` /
 * `phase` / `attempt` per step, `current`, `status`) always do.
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
