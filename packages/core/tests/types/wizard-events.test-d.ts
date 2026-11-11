import { describe, expectTypeOf, it } from 'vitest'
import type {
  AnyWizardDefinition,
  WizardDefinition,
  WizardOutput,
  WizardStep,
} from '../../src/authoring/types'
import type { DomainEvent } from '../../src/machine/events'
import {
  type ChildRunEvent,
  isChildEvent,
  type RootRunEvent,
  type Run,
  type RunEvent,
} from '../../src/wizard/create-wizard'
import type { CheckoutF, fulfilmentFlow } from './wizard-fixture'

type EventLeafFlow = WizardDefinition<
  unknown,
  unknown,
  {},
  unknown,
  { readonly done: WizardStep<'step', { readonly output: { readonly leaf: true } }, 'sink'> },
  { readonly leaf: true }
>
type EventParentFlow<CF extends AnyWizardDefinition, K extends string> = WizardDefinition<
  unknown,
  unknown,
  {},
  unknown,
  {
    readonly [P in K]: WizardStep<
      'child',
      { readonly output: WizardOutput<CF>; readonly child: CF },
      'sink'
    >
  },
  WizardOutput<CF>
>
type EventDepth1 = EventParentFlow<EventLeafFlow, 'd1'>
type EventDepth2 = EventParentFlow<EventDepth1, 'd2'>
type EventDepth3 = EventParentFlow<EventDepth2, 'd3'>
type EventDepth4 = EventParentFlow<EventDepth3, 'd4'>
type EventDepth5 = EventParentFlow<EventDepth4, 'd5'>
type EventDepth6 = EventParentFlow<EventDepth5, 'd6'>
type EventDepth7 = EventParentFlow<EventDepth6, 'd7'>
type EventDepth8 = EventParentFlow<EventDepth7, 'd8'>

declare const run: Run<CheckoutF>

describe('typed RunEvent', () => {
  it('observe/log events keep each nested flow correlated with its path; isChildEvent narrows', () => {
    type Ids = 'shipping' | 'reserve' | 'awaitPayment' | 'fulfil' | 'receipt'
    run.observe((e) => {
      expectTypeOf(e).toEqualTypeOf<RunEvent<CheckoutF>>()
      expectTypeOf(e.seq).toEqualTypeOf<number>()
      expectTypeOf(e.path).toMatchTypeOf<
        readonly [] | readonly ['fulfil'] | readonly ['fulfil', 'pack']
      >()
      if (isChildEvent(e)) {
        expectTypeOf(e).toEqualTypeOf<ChildRunEvent<CheckoutF>>()
        expectTypeOf(e.path).toMatchTypeOf<readonly ['fulfil'] | readonly ['fulfil', 'pack']>()
        if (e.type === 'step.done') expectTypeOf(e.step).toEqualTypeOf<'label' | 'pack' | 'done'>()
        return
      }
      expectTypeOf(e).toEqualTypeOf<RootRunEvent<CheckoutF>>()
      expectTypeOf(e.path).toEqualTypeOf<readonly []>()
      if (e.type === 'step.done') expectTypeOf(e.step).toEqualTypeOf<Exclude<Ids, 'shipping'>>()
      if (e.type === 'event.received')
        expectTypeOf(e.event).toEqualTypeOf<'payment.captured' | 'payment.failed'>()
      if (e.type === 'run.failed') expectTypeOf(e.step).toEqualTypeOf<Ids | undefined>()
    })
    // Without narrowing, ids are the exact union across the root and its descendants.
    run.observe((e) => {
      if (e.type === 'step.done')
        expectTypeOf(e.step).toEqualTypeOf<
          'reserve' | 'awaitPayment' | 'fulfil' | 'receipt' | 'label' | 'pack' | 'done'
        >()
    })
    expectTypeOf(run.log()).toEqualTypeOf<readonly RunEvent<CheckoutF>[]>()
    const genericEvent: RunEvent = {} as RunEvent<CheckoutF>
    expectTypeOf(genericEvent.type).toEqualTypeOf<RunEvent['type']>()
    // A raw domain event (path: readonly string[]) is neither half without a path refinement.
    expectTypeOf<DomainEvent>().not.toMatchTypeOf<RunEvent>()
  })
  it('correlates committed root event data with the flow', () => {
    type Events = RootRunEvent<CheckoutF>
    type Reserved = Extract<Events, { type: 'step.runSucceeded'; step: 'reserve' }>
    type ReserveDone = Extract<Events, { type: 'step.done'; step: 'reserve' }>
    type Payment = Extract<Events, { type: 'event.received'; event: 'payment.captured' }>
    type ChildStarted = Extract<Events, { type: 'child.started'; step: 'fulfil' }>
    type FulfilmentDone = Extract<Events, { type: 'child.summary'; step: 'fulfil' }>
    type FulfilmentFlowDone = Extract<RootRunEvent<typeof fulfilmentFlow>, { type: 'run.done' }>

    expectTypeOf<Reserved['output']>().toEqualTypeOf<{ reservationId: string }>()
    expectTypeOf<ReserveDone['output']>().toEqualTypeOf<{ reservationId: string } | undefined>()
    expectTypeOf<Payment['payload']>().toEqualTypeOf<{ paymentId: string }>()
    expectTypeOf<ChildStarted['context']>().toEqualTypeOf<{ orderId: string }>()
    expectTypeOf<ChildStarted['childPath']>().toEqualTypeOf<readonly ['fulfil']>()
    expectTypeOf<FulfilmentDone['summary']['current']>().toEqualTypeOf<'confirm' | null>()
    expectTypeOf<FulfilmentDone['done']>().toEqualTypeOf<
      { readonly output: { trackingId: string } } | undefined
    >()
    expectTypeOf<FulfilmentFlowDone['output']>().toEqualTypeOf<{ trackingId: string } | undefined>()
    expectTypeOf<Extract<Events, { type: 'step.done'; step: 'shipping' }>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<Events, { type: 'input.changed' }>['patch']>().toEqualTypeOf<unknown>()
  })
  it('correlates descendant event data with the flow named by path', () => {
    type Events = ChildRunEvent<CheckoutF>
    type LabelSucceeded = Extract<
      Events,
      { path: readonly ['fulfil']; type: 'step.runSucceeded'; step: 'label' }
    >
    type GrandchildValidated = Extract<
      Events,
      { path: readonly ['fulfil', 'pack']; type: 'step.validated'; step: 'pick' }
    >
    type GrandchildStarted = Extract<
      Events,
      { path: readonly ['fulfil']; type: 'child.started'; step: 'pack' }
    >

    expectTypeOf<LabelSucceeded['output']>().toEqualTypeOf<{ trackingId: string }>()
    expectTypeOf<GrandchildValidated['output']>().toEqualTypeOf<{ bin: string }>()
    expectTypeOf<GrandchildStarted['context']>().toEqualTypeOf<{ sku: string }>()
    expectTypeOf<GrandchildStarted['childPath']>().toEqualTypeOf<readonly ['fulfil', 'pack']>()
    expectTypeOf<
      Extract<Events, { path: readonly ['fulfil']; type: 'step.done'; step: 'reserve' }>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Extract<Events, { path: readonly ['fulfil', 'pack']; type: 'step.done'; step: 'label' }>
    >().toEqualTypeOf<never>()
    expectTypeOf<ChildRunEvent['path']>().toEqualTypeOf<readonly [string, ...string[]]>()
    expectTypeOf<Extract<ChildRunEvent, { type: 'step.done' }>['step']>().toEqualTypeOf<string>()
  })
  it('keeps the deepest runtime-supported child path typed', () => {
    type DeepDone = Extract<
      ChildRunEvent<EventDepth8>,
      {
        path: readonly ['d8', 'd7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1']
        type: 'run.done'
      }
    >
    expectTypeOf<DeepDone['output']>().toEqualTypeOf<{ readonly leaf: true } | undefined>()
  })
})
