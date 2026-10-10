/**
 * Shared fixture for the mirror tests: a small checkout flow (view → task → final) with a
 * secret context field, and a deny-by-default projection that exposes the view's draft input
 * and validation issues, the task's output, two context keys and the flow output.
 */
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { defineProjection } from '../../src/projection/define-projection'
import { createWizard, type Wizard, type WizardOptions } from '../../src/wizard/create-wizard'

export interface Deps {
  inventory: { reserve(cartId: string): Promise<{ reservationId: string }> }
}

const s = defineFlow({
  name: 'checkout',
  context: z.object({
    cartId: z.string(),
    total: z.number(),
    express: z.boolean().default(false),
    secret: z.string().default('hunter2'),
  }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(),
})

export const checkout = s.steps(
  {
    shipping: s.view({
      input: z.object({ address: z.string().min(1), express: z.boolean().default(false) }),
      exit: ({ output, update }) => update({ express: output.express }),
      next: 'reserve',
    }),
    reserve: s.task(({ context, deps }) => deps.inventory.reserve(context.cartId), {
      next: 'receipt',
    }),
    receipt: s.final({ output: ({ context }) => ({ cartId: context.cartId }) }),
  },
  { start: 'shipping' },
)

export const checkoutClient = defineProjection(checkout, {
  expose: {
    steps: { shipping: { input: true, issues: true }, reserve: { output: true } },
    context: ['total', 'express'],
    output: true,
  },
})

export const deps: Deps = {
  inventory: { reserve: async (cartId) => ({ reservationId: `res-${cartId}` }) },
}

export function makeWizard(
  extra: Partial<WizardOptions<typeof checkout>> = {},
): Wizard<typeof checkout> {
  return createWizard(checkout, {
    context: { cartId: 'c1', total: 10 },
    deps,
    scheduler: createTestScheduler({ now: 1_000 }),
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...extra,
  })
}

/** Let queued microtasks (async task results) settle. */
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
