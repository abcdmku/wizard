import { boundary, defineWizard } from '@openwizard/core'
import { type EffectDeps, runEffect } from '@openwizard/effect'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'

interface Declined {
  readonly _tag: 'Declined'
  readonly reason: string
}

class Payments extends Context.Service<
  Payments,
  {
    readonly charge: (orderId: string) => Effect.Effect<{ readonly paymentId: string }, Declined>
  }
>()('Payments') {}

export const checkout = defineWizard(
  {
    name: 'effect-checkout',
    context: boundary.trusted<{ readonly orderId: string }>(),
    deps: boundary.trusted<EffectDeps<Payments>>(),
  },
  ({ step, steps }) =>
    steps({
      charge: step({
        run: runEffect(
          ({ context }) => Payments.use((payments) => payments.charge(context.orderId)),
          {
            mapError: (error) => ({ reason: error.reason }),
          },
        ),
      }),
    }),
)

export const batchCheckout = defineWizard(
  {
    name: 'effect-batch-checkout',
    context: boundary.trusted<{ readonly orderIds: readonly string[] }>(),
    deps: boundary.trusted<EffectDeps<Payments>>(),
  },
  ({ step, steps }) => {
    const load = step({ run: () => ({ prefix: 'batch' }) })
    return steps({
      load,
      charges: step({
        needs: { load },
        each: ({ context }) => context.orderIds,
        concurrency: 4,
        run: (args) =>
          runEffect(
            () =>
              Payments.use((payments) => payments.charge(`${args.needs.load.prefix}-${args.item}`)),
            {
              mapError: (error) => ({ reason: error.reason }),
            },
          ),
      }),
    })
  },
)

// One runtime for the application; a test passes a runtime built from another Layer.
const runtime = ManagedRuntime.make(
  Layer.succeed(Payments, {
    charge: (orderId) => Effect.succeed({ paymentId: `payment-${orderId}` }),
  }),
)

export const charge = (orderId: string) => checkout.run({ orderId }, { deps: { runtime } })

export const chargeMany = (orderIds: readonly string[]) =>
  batchCheckout.run({ orderIds }, { deps: { runtime } })

export const closeRuntime = (): Promise<void> => runtime.dispose()
