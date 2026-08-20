/**
 * Type tests — the `FlowRun<F>` surface (ADR-001 case 13): go/setInput/resetInput/validate accept
 * views only, retry tasks only, send known events only, child() flow steps only, `deps` required
 * iff declared; typed Snapshot / RunEvent (root | child) / Command<F> (dispatch is typed, the
 * untrusted door is `parseCommand(flow, unknown)`); createRun / resumeRun(Async) options.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import type {
  AbortSignalLike,
  AnyFlow,
  Ctx,
  Flow,
  FlowOutput,
  FlowStep,
  Issue,
  Progress,
} from '../../src/authoring/types'
import type { WizardErrorCode } from '../../src/errors'
import type { Command as MachineCommand } from '../../src/machine/commands'
import type { DomainEvent } from '../../src/machine/events'
import { defineProjection } from '../../src/projection/define-projection'
import {
  type ChildRunEvent,
  type Command,
  createRun,
  createRunAsync,
  type Explanation,
  type FlowRun,
  isChildEvent,
  type ResumeOptions,
  type RootRunEvent,
  type RunEvent,
  type RunOptions,
  resumeRun,
  resumeRunAsync,
  type Snapshot,
  type SnapshotMigration,
  type StepState,
} from '../../src/wizard/create-wizard'
import { parseCommand } from '../../src/wizard/parse-command'
import type { CommandResult, NavResult, SendResult } from '../../src/wizard/results'

interface CheckoutDeps {
  inventory: {
    reserve(cartId: string, opts: { signal: AbortSignalLike }): Promise<{ reservationId: string }>
  }
}

const grandchild = defineFlow({ name: 'grandchild', context: z.object({ sku: z.string() }) })
const grandchildFlow = grandchild.steps({
  pick: grandchild.view({ input: z.object({ bin: z.string() }), next: 'done' }),
  done: grandchild.final(),
})
const fulfilment = defineFlow({ name: 'fulfilment', context: z.object({ orderId: z.string() }) })
const fulfilmentFlow = fulfilment.steps({
  label: fulfilment.task(async () => ({ trackingId: 'x' }), { next: 'confirm' }),
  confirm: fulfilment.view({ input: z.object({ ok: z.boolean() }), next: 'pack' }),
  pack: fulfilment.flow(grandchildFlow, { context: () => ({ sku: 's' }), next: 'done' }),
  done: fulfilment.final({ output: () => ({ trackingId: 'x' }) }),
})
const checkout = defineFlow({
  name: 'checkout',
  context: z.object({ cartId: z.string(), total: z.number(), express: z.boolean().default(false) }),
  events: {
    'payment.captured': z.object({ paymentId: z.string() }),
    'payment.failed': z.object({ reason: z.string() }),
  },
  deps: boundary.trusted<CheckoutDeps>(),
})
const checkoutFlow = checkout.steps(
  {
    shipping: checkout.view({
      input: z.object({ address: z.string(), express: z.boolean().default(false) }),
      next: 'reserve',
    }),
    reserve: checkout.task(
      ({ context, deps, signal }) => deps.inventory.reserve(context.cartId, { signal }),
      { next: 'awaitPayment' },
    ),
    awaitPayment: checkout.wait({ on: { 'payment.captured': () => {} }, next: 'fulfil' }),
    fulfil: checkout.flow(fulfilmentFlow, {
      context: ({ context }) => ({ orderId: context.cartId }),
      next: 'receipt',
    }),
    receipt: checkout.final(),
  },
  { start: 'shipping' },
)
type CheckoutF = typeof checkoutFlow
type EventLeafFlow = Flow<
  unknown,
  unknown,
  {},
  unknown,
  { readonly done: FlowStep<never, { readonly leaf: true }, never, 'final', never> }
>
type EventParentFlow<CF extends AnyFlow, K extends string> = Flow<
  unknown,
  unknown,
  {},
  unknown,
  { readonly [P in K]: FlowStep<never, FlowOutput<CF>, never, 'flow', CF> }
>
type EventDepth1 = EventParentFlow<EventLeafFlow, 'd1'>
type EventDepth2 = EventParentFlow<EventDepth1, 'd2'>
type EventDepth3 = EventParentFlow<EventDepth2, 'd3'>
type EventDepth4 = EventParentFlow<EventDepth3, 'd4'>
type EventDepth5 = EventParentFlow<EventDepth4, 'd5'>
type EventDepth6 = EventParentFlow<EventDepth5, 'd6'>
type EventDepth7 = EventParentFlow<EventDepth6, 'd7'>
type EventDepth8 = EventParentFlow<EventDepth7, 'd8'>
declare const run: FlowRun<CheckoutF>
declare const untrusted: unknown
/** Type-level probes: a command of the checkout flow, and a child command built from a path. */
declare function cmd(command: Command<CheckoutF>): void
declare function child<const P extends readonly [string, ...string[]], const C>(
  path: P,
  command: C,
): { readonly type: 'child'; readonly path: P; readonly command: C }

describe('case 13: FlowRun<F> method typing', () => {
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
  it('run/retry accept task ids only; send accepts declared events only (payload is unknown, correlationId optional)', () => {
    expectTypeOf(run.retry('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `retry` accepts task ids only
    run.retry('shipping')
    expectTypeOf(run.run('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `run` accepts task ids only
    run.run('shipping')
    // @ts-expect-error `run('typo')`
    run.run('typo')
    expectTypeOf(run.send('payment.captured', { paymentId: 'p' } as unknown)).toEqualTypeOf<
      Promise<SendResult>
    >()
    expectTypeOf(run.send('payment.captured', {}, { correlationId: 'c' })).toEqualTypeOf<
      Promise<SendResult>
    >()
    // @ts-expect-error unknown event
    run.send('payment.typo', {})
    // @ts-expect-error unknown send option
    run.send('payment.captured', {}, { nope: 1 })
  })
  it('child() accepts flow-step ids only and returns a typed child run', () => {
    const child = run.child('fulfil')
    expectTypeOf(child).toEqualTypeOf<FlowRun<typeof fulfilmentFlow>>()
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
    expectTypeOf(run.runReady()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(run.reset()).toEqualTypeOf<Promise<CommandResult>>()
  })
  it('SendResult: every failure carries code + message; rejected keeps issues, dropped keeps reason', async () => {
    const result = await run.send('payment.captured', {})
    if (result.ok) {
      expectTypeOf(result.delivered).toEqualTypeOf<readonly string[]>()
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
  it('v0.2: skip / invalidate take step ids; progress / readyViews are typed selectors; attach hands out the typed send', () => {
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
      expectTypeOf(send).toEqualTypeOf<FlowRun<CheckoutF>['send']>()
      void send('payment.captured', {})
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

describe('typed RunEvent / Command', () => {
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
      if (e.type === 'flow.failed') expectTypeOf(e.step).toEqualTypeOf<Ids | undefined>()
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
    type FulfilmentFlowDone = Extract<RootRunEvent<typeof fulfilmentFlow>, { type: 'flow.done' }>

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
        type: 'flow.done'
      }
    >
    expectTypeOf<DeepDone['output']>().toEqualTypeOf<{ readonly leaf: true } | undefined>()
  })
  it('Command<F> types every id: go/setInput/resetInput views, run/retry tasks, send events, compensate.from steps', () => {
    const go: Command<CheckoutF> = { type: 'go', step: 'shipping' }
    expectTypeOf(go).toMatchTypeOf<Command>()
    // @ts-expect-error `go` rejects a non-view id
    cmd({ type: 'go', step: 'reserve' })
    // @ts-expect-error `go` rejects an unknown id
    cmd({ type: 'go', step: 'typo' })
    // @ts-expect-error `retry` rejects a non-task id
    cmd({ type: 'retry', step: 'shipping' })
    // @ts-expect-error `run` rejects an unknown id
    cmd({ type: 'run', step: 'typo' })
    // @ts-expect-error `send` rejects an unknown event
    cmd({ type: 'send', event: 'nope', payload: {} })
    // @ts-expect-error `compensate.from` is a step id
    cmd({ type: 'compensate', from: 'typo' })
    // `send.payload` stays unknown (re-parsed by the event boundary at runtime).
    cmd({ type: 'send', event: 'payment.captured', payload: 42 })
    // @ts-expect-error `sendRejected` is internal: not a wire command
    cmd({ type: 'sendRejected', event: 'payment.captured', issues: [] })
    // v0.2: `skip` / `invalidate` take any step id of the flow.
    cmd({ type: 'skip', step: 'reserve', reason: 'ops' })
    cmd({ type: 'invalidate', step: 'shipping', cascade: false })
    // @ts-expect-error `skip.step` must be a step id
    cmd({ type: 'skip', step: 'typo' })
    // @ts-expect-error `invalidate.step` must be a step id
    cmd({ type: 'invalidate', step: 'typo' })
    // @ts-expect-error `cascade` is a boolean
    cmd({ type: 'invalidate', step: 'reserve', cascade: 'yes' })
  })
  it('setInput is correlated: the patch is the DraftOf of THAT view', () => {
    cmd({ type: 'setInput', step: 'shipping', patch: { address: 'x', express: true } })
    // @ts-expect-error wrong draft shape for `shipping`
    cmd({ type: 'setInput', step: 'shipping', patch: { address: 1 } })
    // @ts-expect-error unknown draft key
    cmd({ type: 'setInput', step: 'shipping', patch: { nope: 1 } })
    // @ts-expect-error `setInput` rejects a non-view id
    cmd({ type: 'setInput', step: 'reserve', patch: {} })
    // Inside a child command the patch is the CHILD view's draft.
    cmd(child(['fulfil'], { type: 'setInput', step: 'confirm', patch: { ok: true } }))
    // @ts-expect-error `ok` is a boolean in the child's draft
    cmd(child(['fulfil'], { type: 'setInput', step: 'confirm', patch: { ok: 'yes' } }))
  })
  it('child commands are typed by the child flow at the end of the path (single hop, nested and flattened)', () => {
    cmd(child(['fulfil'], { type: 'go', step: 'confirm' }))
    cmd(child(['fulfil'], { type: 'child', path: ['pack'], command: { type: 'go', step: 'pick' } }))
    cmd(child(['fulfil', 'pack'], { type: 'setInput', step: 'pick', patch: { bin: 'b1' } }))
    // @ts-expect-error `path[0]` must be a flow step
    cmd(child(['shipping'], { type: 'next' }))
    // @ts-expect-error `path[0]` must exist
    cmd(child(['typo'], { type: 'next' }))
    // @ts-expect-error the second segment must be a flow step of the child
    cmd(child(['fulfil', 'confirm'], { type: 'next' }))
    // @ts-expect-error the nested command is typed by the child (`shipping` is not a view of `fulfilment`)
    cmd(child(['fulfil'], { type: 'go', step: 'shipping' }))
    // @ts-expect-error … and the flattened form is typed by the grandchild
    cmd(child(['fulfil', 'pack'], { type: 'go', step: 'confirm' }))
    // @ts-expect-error a child command's path is never empty
    cmd({ type: 'child', path: [], command: { type: 'next' } })
  })
  it('dispatch() is typed by the flow; the untrusted door is parseCommand(flow, unknown) → Command<F> (no cast)', () => {
    // @ts-expect-error unknown view id
    run.dispatch({ type: 'go', step: 'typo' })
    // @ts-expect-error unknown event
    run.dispatch({ type: 'send', event: 'nope', payload: {} })
    // @ts-expect-error non-task id
    run.dispatch({ type: 'retry', step: 'shipping' })
    // @ts-expect-error wrong patch
    run.dispatch({ type: 'setInput', step: 'shipping', patch: { address: 1 } })
    // @ts-expect-error a raw machine command (string ids) is not a Command<F>
    run.dispatch({} as MachineCommand)
    const parsed = parseCommand(checkoutFlow, untrusted)
    if (parsed.ok) {
      expectTypeOf(parsed.value).toEqualTypeOf<Command<CheckoutF>>()
      run.dispatch(parsed.value)
    } else {
      expectTypeOf(parsed.issues[0]?.message).toEqualTypeOf<string | undefined>()
    }
    // Every typed command is a valid machine command (what the runtime consumes).
    expectTypeOf<Command<CheckoutF>>().toMatchTypeOf<MachineCommand>()
    expectTypeOf<Command>().toMatchTypeOf<MachineCommand>()
  })
})

describe('createRun / resumeRun options', () => {
  it('context is the INPUT side; deps required iff declared; the option names', () => {
    const created = createRun(checkoutFlow, {
      context: { cartId: 'c', total: 1 }, // `express` optional (schema default), typed INPUT side
      deps: {} as CheckoutDeps,
    })
    expectTypeOf(created).toEqualTypeOf<FlowRun<CheckoutF>>()
    // @ts-expect-error `deps` is required because the flow declares a deps boundary
    createRun(checkoutFlow, { context: { cartId: 'c', total: 1 } })
    // @ts-expect-error context must match the INPUT type
    createRun(checkoutFlow, { context: { cartId: 1, total: 1 }, deps: {} as CheckoutDeps })
    createRun(fulfilmentFlow, { context: { orderId: 'o' } }) // flow without deps → `deps` optional
    expectTypeOf(createRunAsync(fulfilmentFlow, { context: { orderId: 'o' } })).toEqualTypeOf<
      Promise<FlowRun<typeof fulfilmentFlow>>
    >()
    const resumed = resumeRun(checkoutFlow, {} as unknown, { deps: {} as CheckoutDeps })
    expectTypeOf(resumed).toEqualTypeOf<FlowRun<CheckoutF>>()
    // @ts-expect-error resume needs deps too
    resumeRun(checkoutFlow, {} as unknown, {})
    expectTypeOf(
      resumeRunAsync(checkoutFlow, {} as unknown, { deps: {} as CheckoutDeps }),
    ).toEqualTypeOf<Promise<FlowRun<CheckoutF>>>()
    // @ts-expect-error async resume needs deps too
    resumeRunAsync(checkoutFlow, {} as unknown, {})
    expectTypeOf<keyof RunOptions<CheckoutF>>().toEqualTypeOf<
      | 'context'
      | 'deps'
      | 'instanceId'
      | 'correlationId'
      | 'store'
      | 'key'
      | 'autoSave'
      | 'debounceMs'
      | 'redact'
      | 'onPersistError'
      | 'clock'
      | 'scheduler'
      | 'ids'
      | 'beforeEffects'
      | 'beforeTimer'
      | 'strict'
      | 'logSize'
    >()
    expectTypeOf<Parameters<NonNullable<RunOptions<CheckoutF>['redact']>>[0]>().toEqualTypeOf<
      Snapshot<CheckoutF>
    >()
  })
  it('v0.2: createRun takes correlationId; resume takes migrate (and no correlationId)', () => {
    createRun(fulfilmentFlow, { context: { orderId: 'o' }, correlationId: 'order-1' })
    resumeRun(fulfilmentFlow, {} as unknown, {
      migrate: (snapshot, from) => {
        expectTypeOf(snapshot).toEqualTypeOf<unknown>()
        expectTypeOf(from).toEqualTypeOf<{ readonly name: string; readonly version: number }>()
        return snapshot
      },
    })
    expectTypeOf<ResumeOptions<CheckoutF>['migrate']>().toEqualTypeOf<
      SnapshotMigration | undefined
    >()
    // @ts-expect-error the correlation id comes from the snapshot on resume
    resumeRun(fulfilmentFlow, {} as unknown, { correlationId: 'x' })
    // @ts-expect-error `migrate` is a resume-only option
    createRun(fulfilmentFlow, { context: { orderId: 'o' }, migrate: (s: unknown) => s })
  })
})
