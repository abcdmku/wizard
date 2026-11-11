/**
 * `runEffect` as a step, run end to end: the program's success is the step output, a typed
 * failure is recorded as kind `typed` (with `mapError` data), a defect as `defect`, an
 * interruption as `interrupted`; the step's abort signal interrupts the fiber; services and
 * Layer failures come from the runtime passed in deps.
 */
import { boundary, defineWizard, type EachRunArgs } from '@openwizard/core'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { type EffectDeps, runEffect } from '../src/index'

interface Declined {
  readonly _tag: 'Declined'
  readonly reason: string
}
interface Unavailable {
  readonly _tag: 'Unavailable'
}
interface PaymentsShape {
  readonly charge: (orderId: string) => Effect.Effect<{ readonly paymentId: string }, Declined>
}
class Payments extends Context.Service<Payments, PaymentsShape>()('Payments') {}

const options = {
  name: 'effect-checkout',
  context: boundary.trusted<{ readonly orderId: string }>(),
  deps: boundary.trusted<EffectDeps<Payments, Unavailable>>(),
}
const checkout = defineWizard(options, ({ step, steps }) =>
  steps({
    charge: step({
      run: runEffect(
        ({ context }) => Payments.use((payments) => payments.charge(context.orderId)),
        {
          mapError: (error) => ({
            reason: error._tag === 'Declined' ? error.reason : 'payments unavailable',
          }),
        },
      ),
      timeout: 50,
    }),
  }),
)

const runtimes: ManagedRuntime.ManagedRuntime<Payments, Unavailable>[] = []
function runtimeWith(charge: PaymentsShape['charge']) {
  const runtime = ManagedRuntime.make(Layer.succeed(Payments, { charge }))
  runtimes.push(runtime)
  return runtime
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

describe('runEffect', () => {
  it('records the program success as the step output, with services from the runtime in deps', async () => {
    const runtime = runtimeWith((orderId) => Effect.succeed({ paymentId: `payment-${orderId}` }))
    const outcome = await checkout.run({ orderId: 'o-1' }, { deps: { runtime } })
    expect(outcome).toMatchObject({ status: 'done', output: { paymentId: 'payment-o-1' } })
  })

  it("records a typed failure as kind 'typed' with the mapError value as data", async () => {
    const runtime = runtimeWith(() => Effect.fail({ _tag: 'Declined', reason: 'card expired' }))
    const outcome = await checkout.run({ orderId: 'o-1' }, { deps: { runtime } })
    expect(outcome).toMatchObject({
      status: 'halted',
      failure: { step: 'charge', error: { kind: 'typed', data: { reason: 'card expired' } } },
    })
  })

  it('records a Layer that fails to build as a typed failure mapped like the program errors', async () => {
    const runtime = ManagedRuntime.make(
      Layer.effect(Payments, Effect.fail<Unavailable>({ _tag: 'Unavailable' })),
    )
    runtimes.push(runtime)
    const outcome = await checkout.run({ orderId: 'o-1' }, { deps: { runtime } })
    expect(outcome).toMatchObject({
      status: 'halted',
      failure: { error: { kind: 'typed', data: { reason: 'payments unavailable' } } },
    })
  })

  it('retries a typed failure using the mapped error data', async () => {
    let attempts = 0
    const runtime = runtimeWith(() => {
      attempts += 1
      return attempts === 1
        ? Effect.fail({ _tag: 'Declined', reason: 'temporarily unavailable' })
        : Effect.succeed({ paymentId: 'payment-retried' })
    })
    const errors: string[] = []
    const retried = defineWizard(options, ({ step, steps }) =>
      steps({
        charge: step({
          run: runEffect(
            ({ context }) => Payments.use((payments) => payments.charge(context.orderId)),
            {
              mapError: (error) => ({
                reason: error._tag === 'Declined' ? error.reason : 'payments unavailable',
              }),
            },
          ),
          retry: {
            retries: 2,
            when: (error) => {
              errors.push(error.reason)
              return error.reason === 'temporarily unavailable'
            },
          },
        }),
      }),
    )

    expect(await retried.run({ orderId: 'o-1' }, { deps: { runtime } })).toMatchObject({
      status: 'done',
      output: { paymentId: 'payment-retried' },
    })
    expect(errors).toEqual(['temporarily unavailable'])
    expect(attempts).toBe(2)
  })

  it('uses a runtime supplied by provide without asking each run for deps', async () => {
    const runtime = runtimeWith((orderId) => Effect.succeed({ paymentId: `provided-${orderId}` }))
    const provided = checkout.provide({ runtime })
    expect(await provided.run({ orderId: 'o-2' })).toMatchObject({
      status: 'done',
      output: { paymentId: 'provided-o-2' },
    })
  })

  it('uses step overrides for output parsing, retry decisions and durable error data', async () => {
    let attempts = 0
    const runtime = runtimeWith(() => {
      attempts += 1
      return attempts === 1
        ? Effect.fail({ _tag: 'Declined', reason: 'temporarily unavailable' })
        : Effect.succeed({ paymentId: 'payment-retried' })
    })
    const retriedErrors: { source: string; reason: string }[] = []
    const overridden = defineWizard(options, ({ step, steps }) =>
      steps({
        charge: step({
          run: runEffect(
            ({ context }) => Payments.use((payments) => payments.charge(context.orderId)),
            {
              mapError: () => ({ source: 'adapter' }),
            },
          ),
          output: boundary.parse((value) => {
            if (
              typeof value !== 'object' ||
              value === null ||
              !('paymentId' in value) ||
              typeof value.paymentId !== 'string'
            ) {
              throw new TypeError('expected a payment receipt')
            }
            return `receipt-${value.paymentId}`
          }),
          mapError: (error) => ({
            source: 'step',
            reason:
              typeof error === 'object' &&
              error !== null &&
              'reason' in error &&
              typeof error.reason === 'string'
                ? error.reason
                : 'payments unavailable',
          }),
          retry: {
            retries: 2,
            when: (error) => {
              retriedErrors.push(error)
              return error.reason === 'temporarily unavailable'
            },
          },
        }),
      }),
    )
    expect(await overridden.run({ orderId: 'o-1' }, { deps: { runtime } })).toMatchObject({
      status: 'done',
      output: 'receipt-payment-retried',
    })
    expect(retriedErrors).toEqual([{ source: 'step', reason: 'temporarily unavailable' }])
    expect(attempts).toBe(2)

    const declined = runtimeWith(() => Effect.fail({ _tag: 'Declined', reason: 'card expired' }))
    expect(await overridden.run({ orderId: 'o-2' }, { deps: { runtime: declined } })).toMatchObject(
      {
        status: 'halted',
        failure: { error: { kind: 'typed', data: { source: 'step', reason: 'card expired' } } },
      },
    )
  })

  it('forwards joined data, items and update/progress hooks to a reusable Effect program', async () => {
    const runtime = runtimeWith((orderId) => Effect.succeed({ paymentId: orderId }))
    const charge = runEffect(
      (
        args: EachRunArgs<
          { orderIds: readonly string[]; completed: number },
          EffectDeps<Payments, Unavailable>,
          { prefix: string },
          string
        >,
      ) =>
        Effect.gen(function* () {
          const output = yield* Payments.use((payments) =>
            payments.charge(`${args.needs.prefix}-${args.item}-${args.index}`),
          )
          args.update((context) => ({ completed: context.completed + 1 }))
          args.progress({ charged: args.item })
          return output
        }),
    )
    const batch = defineWizard(
      {
        name: 'effect-batch',
        context: boundary.trusted<{ orderIds: readonly string[]; completed: number }>(),
        deps: boundary.trusted<EffectDeps<Payments, Unavailable>>(),
      },
      ({ step, steps }) => {
        const prefix = step({ run: () => 'payment' })
        return steps({
          prefix,
          charges: step({
            needs: { prefix },
            each: ({ context }) => context.orderIds,
            concurrency: 2,
            run: charge,
          }),
        })
      },
    )
    const run = batch.create({ orderIds: ['o-1', 'o-2'], completed: 0 }, { deps: { runtime } })
    const charged: string[] = []
    run.observe((event) => {
      if (
        event.type !== 'step.progress' ||
        event.value === null ||
        typeof event.value !== 'object' ||
        Array.isArray(event.value)
      )
        return
      if ('charged' in event.value && typeof event.value.charged === 'string')
        charged.push(event.value.charged)
    })
    try {
      await run.start()
      expect(await run.awaitResult()).toMatchObject({
        status: 'done',
        output: [{ paymentId: 'payment-o-1-0' }, { paymentId: 'payment-o-2-1' }],
      })
      expect(run.getState().context.completed).toBe(2)
      expect(charged).toEqual(['o-1', 'o-2'])
    } finally {
      run.dispose()
    }
  })

  it("records a defect as kind 'defect' with the defect's message", async () => {
    const runtime = runtimeWith(() => Effect.die(new Error('card reader exploded')))
    const outcome = await checkout.run({ orderId: 'o-1' }, { deps: { runtime } })
    expect(outcome).toMatchObject({
      status: 'halted',
      failure: { error: { kind: 'defect', message: 'card reader exploded' } },
    })
  })

  it("records an Effect that interrupts itself as kind 'interrupted'", async () => {
    const runtime = runtimeWith(() => Effect.interrupt)
    const outcome = await checkout.run({ orderId: 'o-1' }, { deps: { runtime } })
    expect(outcome).toMatchObject({ status: 'halted', failure: { error: { kind: 'interrupted' } } })
  })

  it('interrupts the fiber when the step aborts (timeout)', async () => {
    let released = false
    const runtime = runtimeWith(() =>
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            released = true
          }),
        ),
      ),
    )
    const outcome = await checkout.run({ orderId: 'o-1' }, { deps: { runtime } })
    expect(outcome).toMatchObject({ status: 'halted', failure: { error: { kind: 'timeout' } } })
    expect(released).toBe(true)
  })
})
