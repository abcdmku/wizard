/**
 * Type tests — the `Wizard<F>` surface (ADR-001 case 13): go/setInput/resetInput/validate accept
 * views only, retry tasks only, send known events only, child() flow steps only, `deps` required
 * iff declared; typed Snapshot / WizardEvent (root | child) / Command<F> (dispatch is typed, the
 * untrusted door is `parseCommand(flow, unknown)`); createWizard / resumeWizard(Async) options.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import type { AbortSignalLike, Ctx, Issue } from '../../src/authoring/types'
import type { WizardErrorCode } from '../../src/errors'
import type { Command as MachineCommand } from '../../src/machine/commands'
import type { DomainEvent } from '../../src/machine/events'
import { defineProjection } from '../../src/projection/define-projection'
import {
  type ChildWizardEvent,
  type Command,
  createWizard,
  createWizardAsync,
  type Explanation,
  isChildEvent,
  type RootWizardEvent,
  resumeWizard,
  resumeWizardAsync,
  type Snapshot,
  type StepState,
  type Wizard,
  type WizardEvent,
  type WizardOptions,
} from '../../src/wizard/create-wizard'
import { parseCommand } from '../../src/wizard/parse-command'
import type { CommandResult, NavResult, SendResult } from '../../src/wizard/results'

interface CheckoutDeps {
  inventory: {
    reserve(cartId: string, opts: { signal: AbortSignalLike }): Promise<{ reservationId: string }>
  }
}

const g = defineFlow({ name: 'grandchild', context: z.object({ sku: z.string() }) })
const grandchild = g.steps({
  pick: g.view({ input: z.object({ bin: z.string() }), next: 'done' }),
  done: g.final(),
})
const f = defineFlow({ name: 'fulfilment', context: z.object({ orderId: z.string() }) })
const fulfilment = f.steps({
  label: f.task(async () => ({ trackingId: 'x' }), { next: 'confirm' }),
  confirm: f.view({ input: z.object({ ok: z.boolean() }), next: 'pack' }),
  pack: f.flow(grandchild, { context: () => ({ sku: 's' }), next: 'done' }),
  done: f.final({ output: () => ({ trackingId: 'x' }) }),
})
const c = defineFlow({
  name: 'checkout',
  context: z.object({ cartId: z.string(), total: z.number(), express: z.boolean().default(false) }),
  events: {
    'payment.captured': z.object({ paymentId: z.string() }),
    'payment.failed': z.object({ reason: z.string() }),
  },
  deps: boundary.trusted<CheckoutDeps>(),
})
const checkout = c.steps(
  {
    shipping: c.view({
      input: z.object({ address: z.string(), express: z.boolean().default(false) }),
      next: 'reserve',
    }),
    reserve: c.task(
      ({ context, deps, signal }) => deps.inventory.reserve(context.cartId, { signal }),
      { next: 'awaitPayment' },
    ),
    awaitPayment: c.wait({ on: { 'payment.captured': () => {} }, next: 'fulfil' }),
    fulfil: c.flow(fulfilment, {
      context: ({ context }) => ({ orderId: context.cartId }),
      next: 'receipt',
    }),
    receipt: c.final(),
  },
  { start: 'shipping' },
)
type CheckoutF = typeof checkout
declare const wizard: Wizard<CheckoutF>
declare const untrusted: unknown
/** Type-level probes: a command of the checkout flow, and a child command built from a path. */
declare function cmd(command: Command<CheckoutF>): void
declare function child<const P extends readonly [string, ...string[]], const C>(
  path: P,
  command: C,
): { readonly type: 'child'; readonly path: P; readonly command: C }

describe('case 13: Wizard<F> method typing', () => {
  it('go/setInput/resetInput/validate accept view ids only', () => {
    expectTypeOf(wizard.go('shipping')).toEqualTypeOf<Promise<NavResult>>()
    // @ts-expect-error `go` accepts view ids only
    wizard.go('reserve')
    // @ts-expect-error `go('typo')`
    wizard.go('typo')
    expectTypeOf(wizard.setInput('shipping', { address: 'x' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error draft must match the input schema (INPUT side)
    wizard.setInput('shipping', { address: 1 })
    // @ts-expect-error unknown draft key
    wizard.setInput('shipping', { nope: 1 })
    // @ts-expect-error `resetInput` accepts view ids only
    wizard.resetInput('reserve')
    // @ts-expect-error `validate` accepts view ids only
    wizard.validate('fulfil')
  })
  it('run/retry accept task ids only; send accepts declared events only (payload is unknown, correlationId optional)', () => {
    expectTypeOf(wizard.retry('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `retry` accepts task ids only
    wizard.retry('shipping')
    expectTypeOf(wizard.run('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `run` accepts task ids only
    wizard.run('shipping')
    // @ts-expect-error `run('typo')`
    wizard.run('typo')
    expectTypeOf(wizard.send('payment.captured', { paymentId: 'p' } as unknown)).toEqualTypeOf<
      Promise<SendResult>
    >()
    expectTypeOf(wizard.send('payment.captured', {}, { correlationId: 'c' })).toEqualTypeOf<
      Promise<SendResult>
    >()
    // @ts-expect-error unknown event
    wizard.send('payment.typo', {})
    // @ts-expect-error unknown send option
    wizard.send('payment.captured', {}, { nope: 1 })
  })
  it('child() accepts flow-step ids only and returns a typed child wizard', () => {
    const child = wizard.child('fulfil')
    expectTypeOf(child).toEqualTypeOf<Wizard<typeof fulfilment>>()
    expectTypeOf(child.getState().context).toEqualTypeOf<Ctx<typeof fulfilment>>()
    // @ts-expect-error `child('viewStep')` rejected
    wizard.child('shipping')
  })
  it('project() accepts a projection of this flow only', () => {
    const projection = defineProjection(checkout, {
      expose: { steps: { shipping: { input: true } }, context: ['total'] },
    })
    const projected = wizard.project(projection)
    expectTypeOf(projected.context).toEqualTypeOf<{ total: number }>()
    expectTypeOf(projected.current).toEqualTypeOf<'shipping' | null>()
    const other = defineProjection(fulfilment, { expose: {} })
    // @ts-expect-error a projection of another flow is rejected
    wizard.project(other)
  })
  it('compensate/dispatch/getState/subscribe/observe/log/save/dispose/id/epoch/flow are present', () => {
    expectTypeOf(wizard.compensate({ from: 'reserve' })).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `compensate.from` is a step id
    wizard.compensate({ from: 'typo' })
    expectTypeOf(wizard.dispatch({ type: 'go', step: 'shipping' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    expectTypeOf(wizard.id).toEqualTypeOf<string>()
    expectTypeOf(wizard.epoch).toEqualTypeOf<number>()
    expectTypeOf(wizard.flow).toEqualTypeOf<CheckoutF>()
    expectTypeOf(wizard.subscribe(() => {})).toEqualTypeOf<() => void>()
    expectTypeOf(wizard.save()).toEqualTypeOf<Promise<void>>()
    expectTypeOf(wizard.dispose()).toEqualTypeOf<void>()
    expectTypeOf(wizard.start()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(wizard.runReady()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(wizard.reset()).toEqualTypeOf<Promise<CommandResult>>()
  })
  it('SendResult: every failure carries code + message; rejected keeps issues, dropped keeps reason', async () => {
    const result = await wizard.send('payment.captured', {})
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
    expectTypeOf(wizard.explain('reserve')).toEqualTypeOf<Explanation<CheckoutF>>()
    expectTypeOf(wizard.explain('fulfil').candidates).toEqualTypeOf<readonly 'shipping'[]>()
    expectTypeOf(wizard.explain('shipping').reasons).toEqualTypeOf<readonly string[]>()
    // @ts-expect-error `explain('typo')`
    wizard.explain('typo')
  })
})

describe('typed Snapshot / StepState', () => {
  it('getSnapshot() is the typed envelope; getState() the typed state', () => {
    const snap = wizard.getSnapshot()
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
    expectTypeOf(snap.children.fulfil).toEqualTypeOf<Snapshot<typeof fulfilment> | undefined>()
    // @ts-expect-error only flow steps have child snapshots
    snap.children.shipping
    expectTypeOf(wizard.getState()).toEqualTypeOf<Snapshot<CheckoutF>['state']>()
    expectTypeOf(wizard.getState().steps.reserve.status).toEqualTypeOf<
      StepState<CheckoutF, 'reserve'>['status']
    >()
  })
})

describe('typed WizardEvent / Command', () => {
  it('observe/log events: root events carry StepId/EventType (path []), child events string ids (path [step, …]); isChildEvent narrows', () => {
    type Ids = 'shipping' | 'reserve' | 'awaitPayment' | 'fulfil' | 'receipt'
    wizard.observe((e) => {
      expectTypeOf(e).toEqualTypeOf<WizardEvent<CheckoutF>>()
      expectTypeOf(e.seq).toEqualTypeOf<number>()
      expectTypeOf(e.path).toEqualTypeOf<readonly [] | readonly [string, ...string[]]>()
      if (isChildEvent(e)) {
        expectTypeOf(e).toEqualTypeOf<ChildWizardEvent>()
        expectTypeOf(e.path).toEqualTypeOf<readonly [string, ...string[]]>()
        if (e.type === 'step.done') expectTypeOf(e.step).toEqualTypeOf<string>()
        if (e.type === 'event.received') expectTypeOf(e.event).toEqualTypeOf<string>()
        return
      }
      expectTypeOf(e).toEqualTypeOf<RootWizardEvent<CheckoutF>>()
      expectTypeOf(e.path).toEqualTypeOf<readonly []>()
      if (e.type === 'step.done') expectTypeOf(e.step).toEqualTypeOf<Ids>()
      if (e.type === 'event.received')
        expectTypeOf(e.event).toEqualTypeOf<'payment.captured' | 'payment.failed'>()
      if (e.type === 'flow.failed') expectTypeOf(e.step).toEqualTypeOf<Ids | undefined>()
    })
    // Without narrowing, ids are the union of both halves (i.e. string).
    wizard.observe((e) => {
      if (e.type === 'step.done') expectTypeOf(e.step).toEqualTypeOf<string>()
    })
    expectTypeOf(wizard.log()).toEqualTypeOf<readonly WizardEvent<CheckoutF>[]>()
    expectTypeOf<WizardEvent<CheckoutF>>().toMatchTypeOf<WizardEvent>()
    // A raw domain event (path: readonly string[]) is neither half without a path refinement.
    expectTypeOf<DomainEvent>().not.toMatchTypeOf<WizardEvent>()
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
    wizard.dispatch({ type: 'go', step: 'typo' })
    // @ts-expect-error unknown event
    wizard.dispatch({ type: 'send', event: 'nope', payload: {} })
    // @ts-expect-error non-task id
    wizard.dispatch({ type: 'retry', step: 'shipping' })
    // @ts-expect-error wrong patch
    wizard.dispatch({ type: 'setInput', step: 'shipping', patch: { address: 1 } })
    // @ts-expect-error a raw machine command (string ids) is not a Command<F>
    wizard.dispatch({} as MachineCommand)
    const parsed = parseCommand(checkout, untrusted)
    if (parsed.ok) {
      expectTypeOf(parsed.value).toEqualTypeOf<Command<CheckoutF>>()
      wizard.dispatch(parsed.value)
    } else {
      expectTypeOf(parsed.issues[0]?.message).toEqualTypeOf<string | undefined>()
    }
    // Every typed command is a valid machine command (what the runtime consumes).
    expectTypeOf<Command<CheckoutF>>().toMatchTypeOf<MachineCommand>()
    expectTypeOf<Command>().toMatchTypeOf<MachineCommand>()
  })
})

describe('createWizard / resumeWizard options', () => {
  it('context is the INPUT side; deps required iff declared; the option names', () => {
    const created = createWizard(checkout, {
      context: { cartId: 'c', total: 1 }, // `express` optional (schema default), typed INPUT side
      deps: {} as CheckoutDeps,
    })
    expectTypeOf(created).toEqualTypeOf<Wizard<CheckoutF>>()
    // @ts-expect-error `deps` is required because the flow declares a deps boundary
    createWizard(checkout, { context: { cartId: 'c', total: 1 } })
    // @ts-expect-error context must match the INPUT type
    createWizard(checkout, { context: { cartId: 1, total: 1 }, deps: {} as CheckoutDeps })
    createWizard(fulfilment, { context: { orderId: 'o' } }) // flow without deps → `deps` optional
    expectTypeOf(createWizardAsync(fulfilment, { context: { orderId: 'o' } })).toEqualTypeOf<
      Promise<Wizard<typeof fulfilment>>
    >()
    const resumed = resumeWizard(checkout, {} as unknown, { deps: {} as CheckoutDeps })
    expectTypeOf(resumed).toEqualTypeOf<Wizard<CheckoutF>>()
    // @ts-expect-error resume needs deps too
    resumeWizard(checkout, {} as unknown, {})
    expectTypeOf(
      resumeWizardAsync(checkout, {} as unknown, { deps: {} as CheckoutDeps }),
    ).toEqualTypeOf<Promise<Wizard<CheckoutF>>>()
    // @ts-expect-error async resume needs deps too
    resumeWizardAsync(checkout, {} as unknown, {})
    expectTypeOf<keyof WizardOptions<CheckoutF>>().toEqualTypeOf<
      | 'context'
      | 'deps'
      | 'instanceId'
      | 'store'
      | 'key'
      | 'autoSave'
      | 'debounceMs'
      | 'redact'
      | 'onPersistError'
      | 'clock'
      | 'scheduler'
      | 'ids'
      | 'strict'
      | 'logSize'
    >()
    expectTypeOf<Parameters<NonNullable<WizardOptions<CheckoutF>['redact']>>[0]>().toEqualTypeOf<
      Snapshot<CheckoutF>
    >()
  })
})
