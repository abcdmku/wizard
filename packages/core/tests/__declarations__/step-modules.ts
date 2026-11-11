import { type AnyStep, defineWizard, type StepApi } from '@openwizard/core'
import { z } from 'zod'
import type { OrderApi } from './header'

/** A child wizard, exported so another module can run it as a step. */
export const address = defineWizard(
  { name: 'declaration-address', context: z.object({ country: z.string() }) },
  ({ view, step, steps }) => {
    const form = view({ input: z.object({ street: z.string(), city: z.string() }) })
    const normalized = step({
      needs: { form },
      run: ({ needs, context }) => ({ ...needs.form, country: context.country }),
    })
    return steps({ form, normalized })
  },
)

/** A step module that works with any wizard. */
export function auditSteps<C, Ev, D>({ step, view }: StepApi<C, Ev, D>) {
  const confirm = view({ input: z.object({ agreed: z.boolean() }), next: 'audit' })
  const audit = step({ needs: { confirm }, run: ({ needs }) => needs.confirm.agreed })
  return { confirm, audit }
}

/** A child-wizard step built for any wizard. */
export function addressStep<C, Ev, D>({ child }: StepApi<C, Ev, D>) {
  return child(address, { context: () => ({ country: 'NL' }) })
}

/** A step that waits for any other step and ignores its output. */
export function afterStep<C, Ev, D>({ step }: StepApi<C, Ev, D>, previous: AnyStep) {
  return step({ needs: { previous }, run: () => 'after' })
}

/** A step module bound to one wizard's context, events and deps. */
export function paymentSteps({ step }: OrderApi) {
  const charge = step({
    run: ({ context, deps, idempotencyKey }) => deps.charge(context.orderId, idempotencyKey),
    retry: { retries: 2, backoff: 'exponential' },
    idempotencyKey: ({ context }) => `charge:${context.orderId}`,
    mapError: (error) => ({ reason: String(error) }),
    compensate: ({ update }) => update({ note: 'refunded' }),
    fallback: 'chargeFailed',
    next: 'settled',
  })
  const settled = step({
    waitFor: {
      'payment.settled': ({ payload }) => ({ done: { paymentId: payload.paymentId } }),
    },
    timeout: { after: '1h', next: 'settleTimedOut' },
  })
  const chargeFailed = step({ run: () => ({ status: 'failed' as const }) })
  const settleTimedOut = step({ run: () => ({ status: 'timed-out' as const }) })
  const pause = step({ sleep: '5m' })
  const route = step({
    needs: { settled },
    targets: ['receipts', 'pause'],
    next: ({ needs }) => (needs.settled.paymentId === '' ? 'pause' : 'receipts'),
  })
  const receipts = step({
    needs: { settled },
    each: ({ needs }) => [needs.settled.paymentId],
    run: ({ item }) => ({ receipt: item }),
    when: ({ context }) => context.note === undefined,
  })
  return { charge, settled, chargeFailed, settleTimedOut, pause, route, receipts }
}
