import {
  boundary,
  defineWizard,
  type ErrorOf,
  type FlowOutput,
  type OutputOf,
} from '@openwizard/core'
import { Context, type Effect } from 'effect'
import { describe, expectTypeOf, it } from 'vitest'
import { type EffectDeps, runEffect } from '../src'

interface Declined {
  readonly _tag: 'Declined'
  readonly reason: string
}
interface LayerDown {
  readonly _tag: 'LayerDown'
}
class Payments extends Context.Service<
  Payments,
  { readonly charge: (id: string) => Effect.Effect<{ paymentId: string }, Declined> }
>()('DeferredPayments') {}
class Mailer extends Context.Service<
  Mailer,
  { readonly send: (id: string) => Effect.Effect<void> }
>()('DeferredMailer') {}

describe('deferred Effect adapters', () => {
  it('infers joined data, items, services, output and mapped retry errors', () => {
    const batch = defineWizard(
      {
        name: 'deferred-effect-batch',
        context: boundary.trusted<{ prefix: string; orderIds: readonly string[] }>(),
        deps: boundary.trusted<EffectDeps<Payments, LayerDown>>(),
      },
      ({ step, steps }) => {
        const load = step({ run: () => ({ offset: 1 }) })
        return steps({
          load,
          charges: step({
            needs: { load },
            each: ({ context }) => context.orderIds,
            run: (args) => {
              expectTypeOf(args.item).toEqualTypeOf<string>()
              expectTypeOf(args.index).toEqualTypeOf<number>()
              expectTypeOf(args.needs.load).toEqualTypeOf<{ offset: number }>()
              expectTypeOf(args.context.prefix).toEqualTypeOf<string>()
              expectTypeOf(args.deps).toEqualTypeOf<EffectDeps<Payments, LayerDown>>()
              return runEffect(
                () =>
                  Payments.use((payments) =>
                    payments.charge(
                      `${args.context.prefix}-${args.item}-${args.index + args.needs.load.offset}`,
                    ),
                  ),
                {
                  mapError: (error) => {
                    expectTypeOf(error).toEqualTypeOf<Declined | LayerDown>()
                    return { reason: error._tag === 'Declined' ? error.reason : 'unavailable' }
                  },
                },
              )
            },
            retry: {
              retries: 1,
              when: (error) => {
                expectTypeOf(error).toEqualTypeOf<{ reason: string }>()
                return error.reason === 'unavailable'
              },
            },
          }),
        })
      },
    )
    expectTypeOf<OutputOf<typeof batch, 'charges'>>().toEqualTypeOf<{ paymentId: string }[]>()
    expectTypeOf<ErrorOf<typeof batch, 'charges'>>().toEqualTypeOf<{ reason: string }>()
    expectTypeOf<FlowOutput<typeof batch>>().toEqualTypeOf<{ paymentId: string }[]>()
  })

  it('infers a joined async adapter with services and mapped errors', () => {
    const joined = defineWizard(
      {
        name: 'deferred-effect-join',
        context: boundary.trusted<{}>(),
        deps: boundary.trusted<EffectDeps<Payments>>(),
      },
      ({ step, steps }) => {
        const load = step({ run: () => ({ count: 3 }) })
        return steps({
          load,
          total: step({
            needs: { load },
            run: async ({ needs }) =>
              runEffect(
                () => Payments.use((payments) => payments.charge(String(needs.load.count * 2))),
                {
                  mapError: (error) => ({ reason: error.reason }),
                },
              ),
          }),
        })
      },
    )
    expectTypeOf<OutputOf<typeof joined, 'total'>>().toEqualTypeOf<{ paymentId: string }>()
    expectTypeOf<ErrorOf<typeof joined, 'total'>>().toEqualTypeOf<{ reason: string }>()
    expectTypeOf<FlowOutput<typeof joined>>().toEqualTypeOf<{ paymentId: string }>()
  })

  it('rejects deferred programs whose services are missing from deps', () => {
    defineWizard(
      {
        name: 'missing-deferred-service',
        context: boundary.trusted<{ orderIds: readonly string[] }>(),
        deps: boundary.trusted<EffectDeps<Payments, LayerDown>>(),
      },
      ({ step, steps }) =>
        steps({
          notify: step({
            each: ({ context }) => context.orderIds,
            run: (args) =>
              runEffect(
                // @ts-expect-error Mailer is not provided by the Payments runtime
                () => Mailer.use((mailer) => mailer.send(args.item)),
              ),
          }),
        }),
    )
  })
})
