/**
 * The wizard behind the landing demo. It runs for real in the browser with `@openwizard/core`:
 * a charge that must not happen twice, a wait for a review event, and a final shipment.
 */
import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface Payments {
  charge(
    orderId: string,
    amount: number,
    options: { readonly idempotencyKey: string },
  ): Promise<{ chargeId: string }>
  /** Distinct charges the provider has accepted so far. */
  count(): number
  reset(): void
}

/**
 * A fake payment provider. It accepts a charge the moment it is called (so a crash after the call
 * still leaves a real charge behind) but answers slowly, which is the window the demo crashes in.
 * A second call with the same idempotency key returns the stored charge at once.
 */
export function createPayments(onAccepted: (count: number) => void, replyMs = 6_000): Payments {
  const accepted = new Map<string, string>()
  return {
    charge(orderId, _amount, { idempotencyKey }) {
      const existing = accepted.get(idempotencyKey)
      if (existing) return Promise.resolve({ chargeId: existing })
      const chargeId = `ch_${orderId}_${accepted.size + 1}`
      accepted.set(idempotencyKey, chargeId)
      onAccepted(accepted.size)
      return new Promise((resolve) => setTimeout(() => resolve({ chargeId }), replyMs))
    },
    count: () => accepted.size,
    reset: () => accepted.clear(),
  }
}

export const orderWizard = defineWizard(
  {
    name: 'landing-order',
    context: z.object({
      orderId: z.string(),
      amount: z.number().positive(),
      chargeId: z.string().optional(),
      approvedBy: z.string().optional(),
    }),
    events: { 'review.approved': z.object({ by: z.string() }) },
    deps: boundary.trusted<{ payments: Payments }>(),
  },
  ({ step, steps }) =>
    steps(
      {
        validateOrder: step({
          run: async ({ context }) => ({ lines: 1, amount: context.amount }),
          next: 'chargeCard',
        }),
        chargeCard: step({
          run: ({ context, deps, idempotencyKey }) =>
            deps.payments.charge(context.orderId, context.amount, { idempotencyKey }),
          // Resume reruns this task with the same key after a crash.
          idempotencyKey: ({ context }) => `order:${context.orderId}:charge`,
          exit: ({ output, update }) => update({ chargeId: output.chargeId }),
          next: 'fraudReview',
        }),
        fraudReview: step({
          waitFor: {
            'review.approved': ({ payload, update }) => update({ approvedBy: payload.by }),
          },
          timeout: { after: '30m', next: 'expired' },
          next: 'fulfillOrder',
        }),
        fulfillOrder: step({
          run: async ({ context }) => ({ shipment: `shp_${context.orderId}` }),
          next: 'shipped',
        }),
        shipped: step({
          run: ({ context }) =>
            `charged once (${context.chargeId}), approved by ${context.approvedBy}`,
        }),
        expired: step({ run: () => 'review timed out' }),
      },
      { start: 'validateOrder' },
    ),
)

export type OrderWizard = typeof orderWizard
export const STEP_NAMES = ['validateOrder', 'chargeCard', 'fraudReview', 'fulfillOrder'] as const
