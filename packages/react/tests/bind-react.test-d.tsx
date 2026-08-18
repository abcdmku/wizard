/**
 * Type tests — `bindReact<T>()` (ADR-001 case 14): hooks typed from a projection (Mirror
 * source) or a flow (Wizard source); `useStep('typo')` rejected; `setInput` typed by `DraftOf`;
 * `Provider` accepts the matching source only; `useSelector` reads the exposed state;
 * `useActions` results follow the source (NavResult vs CommandResult).
 */
import {
  type CommandResult,
  defineFlow,
  defineProjection,
  type Mirror,
  type MirrorChild,
  type NavResult,
  type ProjectionOutput,
  type SendResult,
  type Snapshot,
  type StepState,
  type StepStatus,
  type Wizard,
} from '@openwizard/core'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { bindReact } from '../src/index'
import type {
  Actions,
  ChildBinding,
  ChildBindingId,
  ChildStateOf,
  ProviderProps,
  ReactBinding,
  SourceOf,
  StateOf,
  UseStepResult,
} from '../src/types'
import type { checkout, checkoutClient } from './fixture'

declare const wizard: Wizard<typeof checkout>
declare const mirror: Mirror<typeof checkoutClient>
type Client = ProjectionOutput<typeof checkoutClient>

describe('bindReact<typeof projection>() — Mirror source', () => {
  const ow = bindReact<typeof checkoutClient>()
  it('is a named ReactBinding; the state is the projected ClientState', () => {
    expectTypeOf(ow).toEqualTypeOf<ReactBinding<typeof checkoutClient>>()
    expectTypeOf<StateOf<typeof checkoutClient>>().toEqualTypeOf<Client>()
    expectTypeOf(ow.useSnapshot()).toEqualTypeOf<Client>()
    expectTypeOf(ow.useSnapshot().context).toEqualTypeOf<{ total: number; express: boolean }>()
    // @ts-expect-error `secret` is not exposed by the projection
    ow.useSnapshot().context.secret
  })
  it('useStep is typed by the step id: record fields + bound helpers', () => {
    const st = ow.useStep('shipping')
    expectTypeOf(st).toEqualTypeOf<UseStepResult<typeof checkoutClient, 'shipping'>>()
    expectTypeOf(st.status).toEqualTypeOf<Client['steps']['shipping']['status']>()
    expectTypeOf(st.input).toEqualTypeOf<
      { address?: string; express?: boolean | undefined } | undefined
    >()
    expectTypeOf(st.setInput).parameter(0).toEqualTypeOf<{
      address?: string
      express?: boolean | undefined
    }>()
    expectTypeOf(st.setInput({ address: 'x' })).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(st.next()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(st.back()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(st.go()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(st.resetInput()).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error draft key must exist on the input schema
    st.setInput({ nope: 1 })
    // @ts-expect-error case 14 — `useStep('typo')` rejected
    ow.useStep('typo')
    const task = ow.useStep('reserve')
    expectTypeOf(task.output).toEqualTypeOf<{ reservationId: string } | undefined>()
    expectTypeOf(task.next()).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error task steps have no draft: `setInput` is not offered
    task.setInput({})
    // @ts-expect-error `go` targets view steps only
    task.go()
  })
  it('useCurrent is the current view record or null; useSelector reads the projected state', () => {
    const current = ow.useCurrent()
    expectTypeOf(current).toEqualTypeOf<Client['steps']['shipping'] | null>()
    expectTypeOf(ow.useSelector((s) => s.steps.reserve.status)).toEqualTypeOf<
      Client['steps']['reserve']['status']
    >()
    // @ts-expect-error unexposed context field
    ow.useSelector((s) => s.context.cartId)
    ow.useSelector(
      (s) => ({ total: s.context.total }),
      (a, b) => a.total === b.total,
    )
  })
  it('useActions mirrors the Mirror sugar (CommandResult everywhere)', () => {
    const actions = ow.useActions()
    expectTypeOf(actions).toEqualTypeOf<Actions<typeof checkoutClient>>()
    expectTypeOf(actions.next()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.send('payment.captured', {})).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.send('payment.captured', {}, { correlationId: 'c' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    expectTypeOf(actions.start()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.run('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.reset()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.compensate({ from: 'reserve' })).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `run` accepts task ids only
    actions.run('shipping')
    // @ts-expect-error `compensate.from` is a step id
    actions.compensate({ from: 'typo' })
    // @ts-expect-error `go` accepts view ids only
    actions.go('reserve')
    // @ts-expect-error `retry` accepts task ids only
    actions.retry('shipping')
    // @ts-expect-error unknown event
    actions.send('payment.typo', {})
    // @ts-expect-error `dispatch` is typed by the flow
    actions.dispatch({ type: 'go', step: 'typo' })
  })
  it('Provider takes a Mirror of that projection only; serverSnapshot is the projected state', () => {
    expectTypeOf<SourceOf<typeof checkoutClient>>().toEqualTypeOf<Mirror<typeof checkoutClient>>()
    const ok = <ow.Provider source={mirror} fallback={<p>…</p>} />
    expectTypeOf(ok).toEqualTypeOf<React.JSX.Element>()
    // @ts-expect-error a Wizard is not a Mirror
    ;<ow.Provider source={wizard} />
    expectTypeOf<ProviderProps<typeof checkoutClient>['serverSnapshot']>().toEqualTypeOf<
      Client | undefined
    >()
    ;<ow.Provider source={mirror} serverSnapshot={{} as Client} />
    // @ts-expect-error the server snapshot must be the projected state (all base facts present)
    ;<ow.Provider source={mirror} serverSnapshot={{ status: 'idle' }} />
  })
})

describe('bindReact<typeof flow>() — Wizard source', () => {
  const ow = bindReact<typeof checkout>()
  it('state is Snapshot<F>["state"]; step records are StepState<F, K>', () => {
    expectTypeOf(ow.useSnapshot()).toEqualTypeOf<Snapshot<typeof checkout>['state']>()
    expectTypeOf(ow.useSnapshot().context.secret).toEqualTypeOf<string>()
    const st = ow.useStep('shipping')
    expectTypeOf(st.status).toEqualTypeOf<StepState<typeof checkout, 'shipping'>['status']>()
    expectTypeOf(st.runId).toEqualTypeOf<number>()
    expectTypeOf(st.output).toEqualTypeOf<{ address: string; express: boolean } | undefined>()
    expectTypeOf(st.next()).toEqualTypeOf<Promise<NavResult>>()
    expectTypeOf(st.setInput({ express: true })).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `useStep('typo')` rejected
    ow.useStep('typo')
    expectTypeOf(ow.useCurrent()).toEqualTypeOf<StepState<typeof checkout, 'shipping'> | null>()
  })
  it('actions return the Wizard result types', () => {
    const actions = ow.useActions()
    expectTypeOf(actions.next()).toEqualTypeOf<Promise<NavResult>>()
    expectTypeOf(actions.go('shipping')).toEqualTypeOf<Promise<NavResult>>()
    expectTypeOf(actions.send('payment.captured', {})).toEqualTypeOf<Promise<SendResult>>()
    expectTypeOf(actions.send('payment.captured', {}, { correlationId: 'c' })).toEqualTypeOf<
      Promise<SendResult>
    >()
    expectTypeOf(actions.retry('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.run('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.start()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.reset()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.compensate()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf<ProviderProps<typeof checkout>['serverSnapshot']>().toEqualTypeOf<
      Snapshot<typeof checkout>['state'] | undefined
    >()
  })
  it('Provider takes a Wizard of that flow only', () => {
    expectTypeOf<SourceOf<typeof checkout>>().toEqualTypeOf<Wizard<typeof checkout>>()
    ;<ow.Provider source={wizard}>{null}</ow.Provider>
    // @ts-expect-error a Mirror is not a Wizard
    ;<ow.Provider source={mirror} />
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// v0.2 — `useChild(step)`: hooks bound to a nested flow's slice; `skip` / `invalidate` actions
// ─────────────────────────────────────────────────────────────────────────────

const g = defineFlow({ name: 'grandchild', context: z.object({ sku: z.string() }) })
const grandchild = g.steps({
  pick: g.view({ input: z.object({ bin: z.string() }), next: 'done' }),
  done: g.final(),
})
const f = defineFlow({ name: 'fulfilment', context: z.object({ orderId: z.string() }) })
const fulfilment = f.steps({
  confirm: f.view({ input: z.object({ ok: z.boolean() }), next: 'pack' }),
  pack: f.flow(grandchild, { context: () => ({ sku: 's' }), next: 'done' }),
  done: f.final({ output: () => ({ tracking: 't' }) }),
})
const o = defineFlow({ name: 'order', context: z.object({ cartId: z.string() }) })
const order = o.steps({
  pay: o.task(async () => ({ chargeId: 'c' }), { next: 'fulfil' }),
  fulfil: o.flow(fulfilment, {
    context: ({ context }) => ({ orderId: context.cartId }),
    next: 'ship',
  }),
  ship: o.flow(fulfilment, {
    context: ({ context }) => ({ orderId: context.cartId }),
    next: 'end',
  }),
  end: o.final(),
})
const orderClient = defineProjection(order, {
  expose: {
    steps: {
      // `fulfil` exposes a nested projected child state; `ship` only the summary.
      fulfil: {
        child: {
          steps: {
            confirm: { input: true },
            pack: { child: { steps: { pick: { input: true } } } },
          },
          context: ['orderId'],
        },
      },
      ship: { child: true },
    },
  },
})

describe('useChild over a projection (Mirror source)', () => {
  const ow = bindReact<typeof orderClient>()
  it('accepts only flow steps exposed with a nested child spec; hooks are typed by the child slice', () => {
    expectTypeOf<ChildBindingId<typeof orderClient>>().toEqualTypeOf<'fulfil'>()
    const child = ow.useChild('fulfil')
    expectTypeOf(child).toEqualTypeOf<
      ChildBinding<typeof fulfilment, ChildStateOf<typeof orderClient, 'fulfil'>, 'mirror'>
    >()
    // @ts-expect-error `ship` exposes the summary only (`child: true`), not a slice with steps
    ow.useChild('ship')
    // @ts-expect-error `pay` is not a flow step
    ow.useChild('pay')
    // @ts-expect-error unknown step
    ow.useChild('typo')
    const snap = child.useSnapshot()
    expectTypeOf(snap).toEqualTypeOf<ChildStateOf<typeof orderClient, 'fulfil'> | null>()
    if (snap !== null) {
      expectTypeOf(snap.context).toEqualTypeOf<{ orderId: string }>()
      expectTypeOf(snap.current).toEqualTypeOf<'confirm' | null>()
      expectTypeOf(snap.steps.confirm.input).toEqualTypeOf<{ ok?: boolean } | undefined>()
    }
    const confirm = child.useStep('confirm')
    expectTypeOf(confirm.input).toEqualTypeOf<{ ok?: boolean } | undefined>()
    expectTypeOf(confirm.status).toEqualTypeOf<StepStatus>()
    expectTypeOf(confirm.setInput({ ok: true })).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(confirm.next()).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error the child's draft type
    confirm.setInput({ ok: 'yes' })
    // @ts-expect-error `useStep` takes a step of the CHILD flow
    child.useStep('pay')
    // @ts-expect-error `pack` (a flow step) has no `setInput`
    child.useStep('pack').setInput({})
    // Actions are the scoped MirrorChild sugar of the child flow.
    const actions = child.useActions()
    expectTypeOf(actions).toEqualTypeOf<MirrorChild<typeof fulfilment>>()
    expectTypeOf(actions.go('confirm')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error not a view of the child
    actions.go('pay')
    // Nested: the grandchild through `pack`.
    const grand = child.useChild('pack')
    expectTypeOf(grand.useStep('pick').input).toEqualTypeOf<{ bin?: string } | undefined>()
    expectTypeOf(grand.useActions()).toEqualTypeOf<MirrorChild<typeof grandchild>>()
    // @ts-expect-error `confirm` is not a flow step of `fulfilment`
    child.useChild('confirm')
  })
  it('root actions gained skip / invalidate', () => {
    const actions = ow.useActions()
    expectTypeOf(actions.skip('pay', 'ops')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(actions.invalidate('pay', { cascade: false })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error `skip('typo')`
    actions.skip('typo')
  })
})

describe('useChild over a flow (Wizard source)', () => {
  const ow = bindReact<typeof order>()
  it('every flow step is a child binding; the slice is the child snapshot state; nesting reads children', () => {
    expectTypeOf<ChildBindingId<typeof order>>().toEqualTypeOf<'fulfil' | 'ship'>()
    const child = ow.useChild('ship')
    expectTypeOf(child.useSnapshot()).toEqualTypeOf<Snapshot<typeof fulfilment>['state'] | null>()
    const confirm = child.useStep('confirm')
    expectTypeOf(confirm.status).toEqualTypeOf<StepState<typeof fulfilment, 'confirm'>['status']>()
    expectTypeOf(confirm.output).toEqualTypeOf<{ ok: boolean } | undefined>()
    expectTypeOf(confirm.setInput({ ok: false })).toEqualTypeOf<Promise<CommandResult>>()
    const grand = child.useChild('pack')
    expectTypeOf(grand.useSnapshot()).toEqualTypeOf<Snapshot<typeof grandchild>['state'] | null>()
    expectTypeOf(grand.useStep('pick').input).toEqualTypeOf<{ bin?: string } | undefined>()
    // @ts-expect-error `pay` is not a flow step
    ow.useChild('pay')
  })
})
