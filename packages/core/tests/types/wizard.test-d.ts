import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { Ctx, Issue, Progress } from '../../src/authoring/types'
import type { WizardErrorCode } from '../../src/errors'
import { defineProjection } from '../../src/projection/define-projection'
import type {
  Explanation,
  ResumeOptions,
  Run,
  RunOptions,
  Snapshot,
  SnapshotMigration,
  StepState,
} from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'
import type { CommandResult, NavResult, SendResult } from '../../src/wizard/results'
import { type CheckoutDeps, type CheckoutF, checkoutFlow, fulfilmentFlow } from './wizard-fixture'

declare const run: Run<CheckoutF>

describe('Run<F> method typing', () => {
  it('go/setInput/resetInput/validate accept view ids only', () => {
    expectTypeOf(run.go('shipping')).toEqualTypeOf<Promise<NavResult>>()
    // @ts-expect-error `go` accepts view ids only
    run.go('reserve')
    // @ts-expect-error `go('typo')`
    run.go('typo')
    expectTypeOf(run.setInput('shipping', { address: 'x' })).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error draft must match the input schema (INPUT side)
    run.setInput('shipping', { address: 1 })
    // @ts-expect-error unknown draft key
    run.setInput('shipping', { nope: 1 })
    // @ts-expect-error `resetInput` accepts view ids only
    run.resetInput('reserve')
    // @ts-expect-error `validate` accepts view ids only
    run.validate('fulfil')
  })
  it('startStep/retry accept runnable ids only; send accepts declared events with typed or unknown payloads', () => {
    expectTypeOf(run.retry('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    run.retry('reserve', { patch: { total: 2 } })
    // @ts-expect-error the retry patch is a partial context
    run.retry('reserve', { patch: { total: 'two' } })
    // @ts-expect-error `retry` accepts task ids only
    run.retry('shipping')
    expectTypeOf(run.startStep('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error runnable work uses startStep
    run.run('reserve')
    // @ts-expect-error `startStep` accepts runnable ids only
    run.startStep('shipping')
    // @ts-expect-error `startStep('typo')`
    run.startStep('typo')
    expectTypeOf(run.send('payment.captured', { paymentId: 'p' } as unknown)).toEqualTypeOf<
      Promise<SendResult>
    >()
    expectTypeOf(
      run.send('payment.captured', { paymentId: 'p' }, { correlationId: 'c', eventId: 'evt_1' }),
    ).toEqualTypeOf<Promise<SendResult>>()
    // @ts-expect-error a typed payload must match the event's schema input
    run.send('payment.captured', { paymentId: 1 })
    // @ts-expect-error unknown event
    run.send('payment.typo', {})
    // @ts-expect-error unknown send option
    run.send('payment.captured', { paymentId: 'p' }, { nope: 1 })
  })
  it('child() accepts flow-step ids only and returns a typed child run', () => {
    const child = run.child('fulfil')
    expectTypeOf(child).toEqualTypeOf<Run<typeof fulfilmentFlow>>()
    expectTypeOf(child.getState().context).toEqualTypeOf<Ctx<typeof fulfilmentFlow>>()
    // @ts-expect-error `child('viewStep')` rejected
    run.child('shipping')
  })
  it('project() accepts a projection of this flow only', () => {
    const projection = defineProjection(checkoutFlow, {
      expose: { steps: { shipping: { input: true } }, context: ['total'] },
    })
    const projected = run.project(projection)
    expectTypeOf(projected.context).toEqualTypeOf<{ total: number }>()
    expectTypeOf(projected.current).toEqualTypeOf<'shipping' | null>()
    const other = defineProjection(fulfilmentFlow, { expose: {} })
    // @ts-expect-error a projection of another flow is rejected
    run.project(other)
  })
  it('compensate/dispatch/getState/subscribe/observe/log/save/dispose/id/epoch/flow are present', () => {
    expectTypeOf(run.compensate({ from: 'reserve' })).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `compensate.from` is a step id
    run.compensate({ from: 'typo' })
    expectTypeOf(run.dispatch({ type: 'go', step: 'shipping' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    expectTypeOf(run.id).toEqualTypeOf<string>()
    expectTypeOf(run.epoch).toEqualTypeOf<number>()
    expectTypeOf(run.flow).toEqualTypeOf<CheckoutF>()
    expectTypeOf(run.subscribe(() => {})).toEqualTypeOf<() => void>()
    expectTypeOf(run.save()).toEqualTypeOf<Promise<void>>()
    expectTypeOf(run.dispose()).toEqualTypeOf<void>()
    expectTypeOf(run.start()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(run.startReady()).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error ready work uses startReady
    run.runReady()
    expectTypeOf(run.reset()).toEqualTypeOf<Promise<CommandResult>>()
  })
  it('SendResult: every failure carries code + message; rejected keeps issues, dropped keeps reason', async () => {
    const result = await run.send('payment.captured', { paymentId: 'p' })
    if (result.ok) {
      expectTypeOf(result.delivered).toEqualTypeOf<readonly string[]>()
      expectTypeOf(result.duplicate).toEqualTypeOf<true | undefined>()
    } else {
      expectTypeOf(result.message).toEqualTypeOf<string>()
      if (result.reason === 'rejected') {
        expectTypeOf(result.code).toEqualTypeOf<'BOUNDARY_REJECTED'>()
        expectTypeOf(result.issues).toEqualTypeOf<readonly Issue[]>()
      } else {
        expectTypeOf(result.reason).toEqualTypeOf<'dropped'>()
        expectTypeOf(result.code).toEqualTypeOf<WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'>()
      }
    }
  })
  it('explain() accepts any step id of the flow and returns a typed Explanation', () => {
    expectTypeOf(run.explain('reserve')).toEqualTypeOf<Explanation<CheckoutF>>()
    expectTypeOf(run.explain('fulfil').candidates).toEqualTypeOf<readonly 'shipping'[]>()
    expectTypeOf(run.explain('shipping').reasons).toEqualTypeOf<readonly string[]>()
    // @ts-expect-error `explain('typo')`
    run.explain('typo')
  })
  it('skip / invalidate take step ids; progress / readyViews are typed selectors; attach hands out the typed send', () => {
    expectTypeOf(run.skip('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(run.skip('shipping', 'not needed')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `skip('typo')`
    run.skip('typo')
    expectTypeOf(run.invalidate('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(run.invalidate('reserve', { cascade: false })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error `invalidate('typo')`
    run.invalidate('typo')
    // @ts-expect-error unknown invalidate option
    run.invalidate('reserve', { deep: true })
    expectTypeOf(run.progress()).toEqualTypeOf<Progress>()
    expectTypeOf(run.progress()).toEqualTypeOf<{
      readonly done: number
      readonly total: number
      readonly ratio: number
    }>()
    expectTypeOf(run.readyViews()).toEqualTypeOf<readonly 'shipping'[]>()
    const detach = run.attach((send) => {
      expectTypeOf(send).toEqualTypeOf<Run<CheckoutF>['send']>()
      void send('payment.captured', { paymentId: 'p' })
      // @ts-expect-error the attached send is typed by the flow
      void send('payment.typo', {})
      return () => {}
    })
    expectTypeOf(detach).toEqualTypeOf<() => void>()
    // @ts-expect-error a source must return its teardown
    run.attach(() => {})
  })
})

describe('typed Snapshot / StepState', () => {
  it('getSnapshot() is the typed envelope; getState() the typed state', () => {
    const snap = run.getSnapshot()
    expectTypeOf(snap).toEqualTypeOf<Snapshot<CheckoutF>>()
    expectTypeOf(snap.v).toEqualTypeOf<1>()
    expectTypeOf(snap.state.current).toEqualTypeOf<'shipping' | null>()
    expectTypeOf(snap.state.context).toEqualTypeOf<Ctx<CheckoutF>>()
    expectTypeOf(snap.state.output).toEqualTypeOf<undefined>()
    expectTypeOf(snap.state.steps.reserve.output).toEqualTypeOf<
      { reservationId: string } | undefined
    >()
    expectTypeOf(snap.state.steps.shipping.input).toEqualTypeOf<
      { address?: string; express?: boolean | undefined } | undefined
    >()
    expectTypeOf(snap.state.steps.shipping.kind).toEqualTypeOf<'view'>()
    expectTypeOf(snap.state.steps.shipping).toEqualTypeOf<StepState<CheckoutF, 'shipping'>>()
    expectTypeOf(snap.children.fulfil).toEqualTypeOf<Snapshot<typeof fulfilmentFlow> | undefined>()
    // @ts-expect-error only flow steps have child snapshots
    snap.children.shipping
    expectTypeOf(run.getState()).toEqualTypeOf<Snapshot<CheckoutF>['state']>()
    expectTypeOf(run.getState().steps.reserve.status).toEqualTypeOf<
      StepState<CheckoutF, 'reserve'>['status']
    >()
  })
})

describe('wizard creation and resume options', () => {
  it('uses context input and requires unprovided dependencies', () => {
    const created = checkoutFlow.create({ cartId: 'c', total: 1 }, { deps: {} as CheckoutDeps })
    expectTypeOf(created).toEqualTypeOf<Run<CheckoutF>>()
    // @ts-expect-error dependencies declared by the wizard are required
    checkoutFlow.create({ cartId: 'c', total: 1 })
    // @ts-expect-error context must match the boundary input
    checkoutFlow.create({ cartId: 1, total: 1 }, { deps: {} as CheckoutDeps })
    expectTypeOf(fulfilmentFlow.create({ orderId: 'o' })).toEqualTypeOf<
      Run<typeof fulfilmentFlow>
    >()
    expectTypeOf(fulfilmentFlow.createAsync({ orderId: 'o' })).toEqualTypeOf<
      Promise<Run<typeof fulfilmentFlow>>
    >()
    expectTypeOf(checkoutFlow.resume({} as unknown, { deps: {} as CheckoutDeps })).toEqualTypeOf<
      Run<CheckoutF>
    >()
    // @ts-expect-error resume requires unprovided dependencies too
    checkoutFlow.resume({} as unknown, {})
    expectTypeOf(
      checkoutFlow.resumeAsync({} as unknown, { deps: {} as CheckoutDeps }),
    ).toEqualTypeOf<Promise<Run<CheckoutF>>>()
    // @ts-expect-error async resume requires unprovided dependencies too
    checkoutFlow.resumeAsync({} as unknown, {})
    expectTypeOf<Parameters<NonNullable<RunOptions<CheckoutF>['redact']>>[0]>().toEqualTypeOf<
      Snapshot<CheckoutF>
    >()
  })

  it('accepts correlation ids when creating and migrations when resuming', () => {
    fulfilmentFlow.create({ orderId: 'o' }, { correlationId: 'order-1' })
    fulfilmentFlow.resume({} as unknown, {
      migrate: (snapshot, from) => {
        expectTypeOf(snapshot).toEqualTypeOf<unknown>()
        expectTypeOf(from).toEqualTypeOf<{ readonly name: string; readonly version: number }>()
        return snapshot
      },
    })
    expectTypeOf<ResumeOptions<CheckoutF>['migrate']>().toEqualTypeOf<
      SnapshotMigration | undefined
    >()
    // @ts-expect-error correlation ids come from the snapshot on resume
    fulfilmentFlow.resume({} as unknown, { correlationId: 'x' })
    // @ts-expect-error migrations apply only to resume
    fulfilmentFlow.create({ orderId: 'o' }, { migrate: (snapshot: unknown) => snapshot })
  })
})

describe('send payload input', () => {
  const stamped = defineWizard(
    {
      name: 'stamped',
      context: z.object({}),
      events: { paid: z.object({ at: z.string().transform((value) => new Date(value)) }) },
    },
    ({ step, steps }) =>
      steps({
        wait: step({
          waitFor: {
            paid: ({ payload }) => {
              expectTypeOf(payload.at).toEqualTypeOf<Date>()
            },
          },
        }),
      }),
  )
  const run = stamped.create({})
  it('accepts schema input and unknown bodies', () => {
    run.send('paid', { at: '2026-10-03' })
    // @ts-expect-error send takes schema input, before the Date transform
    run.send('paid', { at: new Date() })
    run.send('paid', JSON.parse('{}') as unknown)
  })
})
