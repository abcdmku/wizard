import { boundary, defineWizard } from '@openwizard/core'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { expect, it } from 'vitest'
import { type EffectDeps, runEffect } from '../src'

interface Declined {
  readonly _tag: 'Declined'
  readonly reason: string
}
class Payments extends Context.Service<
  Payments,
  { readonly charge: (id: string) => Effect.Effect<{ paymentId: string }, Declined> }
>()('DeferredPayments') {}

it('awaits mapped adapters with services, ordered outputs, per-item retries and progress', async () => {
  let releaseFirst: () => void = () => {}
  const firstReady = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const attempts = new Map<string, number>()
  const runtime = ManagedRuntime.make(
    Layer.succeed(Payments, {
      charge: (id) => {
        attempts.set(id, (attempts.get(id) ?? 0) + 1)
        if (id === 'payment-o-1-0') {
          if (attempts.get(id) === 1) return Effect.fail({ _tag: 'Declined', reason: 'temporary' })
          return Effect.promise(() => firstReady).pipe(Effect.map(() => ({ paymentId: id })))
        }
        return Effect.succeed({ paymentId: id })
      },
    }),
  )
  const retryErrors: string[] = []
  const batch = defineWizard(
    {
      name: 'deferred-effect-batch',
      context: boundary.trusted<{ orderIds: readonly string[]; completed: number }>(),
      deps: boundary.trusted<EffectDeps<Payments>>(),
    },
    ({ step, steps }) => {
      const prefix = step({ run: () => 'payment' })
      return steps({
        prefix,
        charges: step({
          needs: { prefix },
          each: ({ context }) => context.orderIds,
          concurrency: 2,
          run: async (args) =>
            runEffect(
              (adapterArgs) =>
                Effect.gen(function* () {
                  expect(adapterArgs).toBe(args)
                  const receipt = yield* Payments.use((payments) =>
                    payments.charge(`${args.needs.prefix}-${args.item}-${args.index}`),
                  )
                  args.update((context) => ({ completed: context.completed + 1 }))
                  args.progress({ charged: args.item })
                  return receipt
                }),
              {
                mapError: (error) => ({ reason: error.reason }),
              },
            ),
          retry: {
            attempts: 1,
            when: (error) => {
              retryErrors.push(error.reason)
              return error.reason === 'temporary'
            },
          },
        }),
      })
    },
  ).provide({ runtime })
  const run = batch.create({ orderIds: ['o-1', 'o-2'], completed: 0 })
  const charged: string[] = []
  run.observe((event) => {
    if (
      event.type !== 'step.progress' ||
      event.value === null ||
      typeof event.value !== 'object' ||
      Array.isArray(event.value)
    )
      return
    if ('charged' in event.value && typeof event.value.charged === 'string') {
      charged.push(event.value.charged)
      if (event.value.charged === 'o-2') releaseFirst()
    }
  })
  try {
    await run.start()
    expect(await run.awaitResult()).toMatchObject({
      status: 'done',
      output: [{ paymentId: 'payment-o-1-0' }, { paymentId: 'payment-o-2-1' }],
    })
    expect(run.getState().context.completed).toBe(2)
    expect(charged).toEqual(['o-2', 'o-1'])
    expect(retryErrors).toEqual(['temporary'])
    expect(attempts.get('payment-o-1-0')).toBe(2)
    expect(attempts.get('payment-o-2-1')).toBe(1)
  } finally {
    releaseFirst()
    run.dispose()
    await runtime.dispose()
  }
})
