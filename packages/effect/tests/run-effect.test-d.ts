/**
 * Type tests — `runEffect` as a step: the program's args come from the step (no annotation),
 * the output and the `mapError` value flow into `OutputOf` / `ErrorOf`, `mapError` sees the
 * program's typed error plus the runtime Layer's, and a service the runtime does not provide
 * is a compile error.
 */
import { boundary, defineWizard, type ErrorOf, type OutputOf, type RunArgs } from '@openwizard/core'
import { Context, Effect } from 'effect'
import { describe, expectTypeOf, it } from 'vitest'
import { type EffectDeps, runEffect } from '../src/index'

interface Declined {
  readonly _tag: 'Declined'
  readonly reason: string
}
interface LayerDown {
  readonly _tag: 'LayerDown'
}
class Payments extends Context.Service<
  Payments,
  { readonly charge: (orderId: string) => Effect.Effect<{ paymentId: string }, Declined> }
>()('Payments') {}
class Mailer extends Context.Service<Mailer, { readonly send: () => Effect.Effect<void> }>()(
  'Mailer',
) {}

const options = {
  name: 'orders',
  context: boundary.trusted<{ orderId: string }>(),
  deps: boundary.trusted<EffectDeps<Payments, LayerDown>>(),
}

describe('runEffect as a step', () => {
  it('infers args from the step, output from the program and error data from mapError', () => {
    const orders = defineWizard(options, ({ step, steps }) =>
      steps({
        charge: step({
          run: runEffect(
            ({ context }) => Payments.use((payments) => payments.charge(context.orderId)),
            {
              mapError: (error) => {
                expectTypeOf(error).toEqualTypeOf<Declined | LayerDown>()
                return { reason: error._tag === 'Declined' ? error.reason : 'unavailable' }
              },
            },
          ),
          retry: {
            attempts: 3,
            when: (error) => {
              expectTypeOf(error).toEqualTypeOf<{ reason: string }>()
              return error.reason === 'unavailable'
            },
          },
        }),
      }),
    )
    expectTypeOf<OutputOf<typeof orders, 'charge'>>().toEqualTypeOf<{ paymentId: string }>()
    expectTypeOf<ErrorOf<typeof orders, 'charge'>>().toEqualTypeOf<{ reason: string }>()
  })

  it('rejects a program that needs a service the runtime does not provide', () => {
    defineWizard(options, ({ step, steps }) =>
      steps({
        notify: step({
          // @ts-expect-error `Mailer` is not provided by `EffectDeps<Payments, LayerDown>`
          run: runEffect(() => Mailer.use((mailer) => mailer.send())),
        }),
      }),
    )
  })

  it('lets a step override the adapter output boundary and error mapping', () => {
    const orders = defineWizard(options, ({ step, steps }) =>
      steps({
        charge: step({
          run: runEffect(() => Effect.succeed(1), { mapError: () => ({ source: 'adapter' }) }),
          output: boundary.parse((value) => String(value)),
          mapError: () => ({ reason: 'overridden' }),
          retry: {
            attempts: 2,
            when: (error) => {
              expectTypeOf(error).toEqualTypeOf<{ reason: string }>()
              return error.reason === 'overridden'
            },
          },
        }),
      }),
    )
    expectTypeOf<OutputOf<typeof orders, 'charge'>>().toEqualTypeOf<string>()
    expectTypeOf<ErrorOf<typeof orders, 'charge'>>().toEqualTypeOf<{ reason: string }>()
  })

  it('requires durable JSON error data', () => {
    defineWizard(options, ({ step, steps }) =>
      steps({
        charge: step({
          run: runEffect(() => Effect.fail<Declined>({ _tag: 'Declined', reason: 'expired' }), {
            // @ts-expect-error Date instances cannot be stored as JSON error data
            mapError: () => new Date(),
          }),
        }),
      }),
    )
  })

  it('infers services from annotated args in a reusable program', () => {
    const charge = runEffect(
      (args: RunArgs<{ orderId: string }, EffectDeps<Payments, LayerDown>>) =>
        Payments.use((payments) => payments.charge(args.context.orderId)),
    )
    const orders = defineWizard(options, ({ step, steps }) =>
      steps({ charge: step({ run: charge }) }),
    )
    expectTypeOf<OutputOf<typeof orders, 'charge'>>().toEqualTypeOf<{ paymentId: string }>()
  })

  it('returns a non-callable adapter', () => {
    const adapter = runEffect(() => Effect.succeed(1))
    // @ts-expect-error a run adapter executes through a step
    adapter({})
  })
})
