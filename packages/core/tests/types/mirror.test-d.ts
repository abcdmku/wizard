/**
 * Type tests — the Mirror surface (ADR-001 case 14, mirror half): typed command sugar from the
 * projection's flow (`go` views only, `setInput` by `DraftOf`, `retry` tasks only, `send`
 * declared events only), `getSnapshot()` is the projected state, wire types line up between
 * source, transport and mirror.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineFlow } from '../../src/authoring/define-flow'
import {
  createMirror,
  type Mirror,
  type MirrorChild,
  type MirrorCommands,
} from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource, type MirrorSource } from '../../src/mirror/source'
import type { Transport } from '../../src/mirror/transport'
import type { Frame, WireAck, WireCommand } from '../../src/mirror/wire'
import { parseWireCommand } from '../../src/mirror/wire'
import { defineProjection, type ProjectionOutput } from '../../src/projection/define-projection'
import type { Command, Wizard } from '../../src/wizard/create-wizard'
import type { CommandResult } from '../../src/wizard/results'

const c = defineFlow({
  name: 'checkout',
  context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
})
const checkout = c.steps(
  {
    shipping: c.view({
      input: z.object({ address: z.string(), express: z.boolean().default(false) }),
      next: 'reserve',
    }),
    reserve: c.task(async () => ({ reservationId: 'r' }), { next: 'receipt' }),
    receipt: c.final(),
  },
  { start: 'shipping' },
)
const checkoutClient = defineProjection(checkout, {
  expose: { steps: { shipping: { input: true } }, context: ['total'] },
})
type Client = ProjectionOutput<typeof checkoutClient>
declare const transport: Transport<Client>
declare const wizard: Wizard<typeof checkout>

describe('Mirror<P>: typed sugar over the projection flow', () => {
  const mirror = createMirror<typeof checkoutClient>({ transport })
  it('getSnapshot is the projected state or null; ids are nullable; connected is a boolean', () => {
    expectTypeOf(mirror.getSnapshot()).toEqualTypeOf<Client | null>()
    expectTypeOf(mirror.instanceId).toEqualTypeOf<string | null>()
    expectTypeOf(mirror.epoch).toEqualTypeOf<number | null>()
    expectTypeOf(mirror.seq).toEqualTypeOf<number | null>()
    expectTypeOf(mirror.connected).toEqualTypeOf<boolean>()
    const snapshot = mirror.getSnapshot()
    if (snapshot !== null) {
      expectTypeOf(snapshot.context).toEqualTypeOf<{ total: number }>()
      expectTypeOf(snapshot.current).toEqualTypeOf<'shipping' | null>()
      expectTypeOf(snapshot.steps.shipping.input).toEqualTypeOf<
        { address?: string; express?: boolean | undefined } | undefined
      >()
      // @ts-expect-error `output` is not exposed for `reserve`
      snapshot.steps.reserve.output
    }
  })
  it('go/setInput/resetInput accept view ids; setInput patch is DraftOf', () => {
    expectTypeOf(mirror.go('shipping')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `go('typo')` rejected
    mirror.go('typo')
    // @ts-expect-error `go` accepts view ids only
    mirror.go('reserve')
    expectTypeOf(mirror.setInput('shipping', { address: 'x' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error draft key must exist on the input schema
    mirror.setInput('shipping', { nope: 1 })
    // @ts-expect-error draft value must match the INPUT side
    mirror.setInput('shipping', { address: 1 })
    // @ts-expect-error `resetInput` accepts view ids only
    mirror.resetInput('reserve')
  })
  it('run/retry accept task ids; send accepts declared events (+ correlationId); the whole Wizard sugar is there, as CommandResults', () => {
    expectTypeOf(mirror.retry('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `retry` accepts task ids only
    mirror.retry('shipping')
    expectTypeOf(mirror.run('reserve')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `run` accepts task ids only
    mirror.run('shipping')
    expectTypeOf(mirror.send('payment.captured', { paymentId: 'p' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    expectTypeOf(mirror.send('payment.captured', {}, { correlationId: 'c' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error unknown event
    mirror.send('payment.typo', {})
    expectTypeOf(mirror.start()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.reset()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.compensate()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.compensate({ from: 'reserve', reason: 'ops' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error `compensate.from` is a step id of the projection's flow
    mirror.compensate({ from: 'typo' })
    expectTypeOf(mirror.next()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.back()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.cancel('x')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.runReady()).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.dispatch({ type: 'go', step: 'shipping' })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error `dispatch` is typed by the flow too
    mirror.dispatch({ type: 'go', step: 'typo' })
  })
  it('a Mirror of another projection is a different type', () => {
    const other = defineProjection(checkout, { expose: {} })
    const otherMirror = createMirror<typeof other>({ transport: transport as never })
    expectTypeOf(otherMirror).not.toEqualTypeOf<Mirror<typeof checkoutClient>>()
    // @ts-expect-error `total` is not exposed by `other`
    otherMirror.getSnapshot()?.context.total
  })
  it('v0.2: skip / invalidate sugar, and child(step) scopes the sugar to a nested flow (nestable)', () => {
    expectTypeOf(mirror.skip('reserve', 'ops')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(mirror.invalidate('reserve', { cascade: false })).toEqualTypeOf<
      Promise<CommandResult>
    >()
    // @ts-expect-error `skip('typo')`
    mirror.skip('typo')
    // @ts-expect-error `invalidate('typo')`
    mirror.invalidate('typo')
    // The checkout flow has no flow step: `child` accepts nothing.
    // @ts-expect-error `shipping` is not a flow step
    mirror.child('shipping')
    // @ts-expect-error unknown step
    mirror.child('typo')

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
      done: f.final(),
    })
    const o = defineFlow({ name: 'order', context: z.object({ cartId: z.string() }) })
    const order = o.steps({
      fulfil: o.flow(fulfilment, {
        context: ({ context }) => ({ orderId: context.cartId }),
        next: 'end',
      }),
      end: o.final(),
    })
    const orderClient = defineProjection(order, {
      expose: { steps: { fulfil: { child: { steps: { confirm: { input: true } } } } } },
    })
    const om = createMirror<typeof orderClient>({ transport: transport as never })
    const child = om.child('fulfil')
    expectTypeOf(child).toEqualTypeOf<MirrorChild<typeof fulfilment>>()
    expectTypeOf(child.path).toEqualTypeOf<readonly [string, ...string[]]>()
    expectTypeOf(child.go('confirm')).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(child.setInput('confirm', { ok: true })).toEqualTypeOf<Promise<CommandResult>>()
    expectTypeOf(child.retry('label')).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `go` takes a view of the CHILD flow
    child.go('shipping')
    // @ts-expect-error not a task of the child
    child.retry('confirm')
    // @ts-expect-error the child's draft type
    child.setInput('confirm', { ok: 'yes' })
    // @ts-expect-error `dispatch` is typed by the child flow
    child.dispatch({ type: 'go', step: 'shipping' })
    child.dispatch({ type: 'go', step: 'confirm' })
    // Nested: the grandchild's sugar.
    const grand = child.child('pack')
    expectTypeOf(grand).toEqualTypeOf<MirrorChild<typeof grandchild>>()
    expectTypeOf(grand.setInput('pick', { bin: 'b1' })).toEqualTypeOf<Promise<CommandResult>>()
    // @ts-expect-error `confirm` is not a flow step of `fulfilment`
    child.child('confirm')
    // A child sender has no state of its own: read it from the mirror's snapshot.
    // @ts-expect-error no getSnapshot on a MirrorChild
    child.getSnapshot()
    expectTypeOf(om.getSnapshot()?.steps.fulfil.child?.steps.confirm.input).toEqualTypeOf<
      { ok?: boolean } | undefined
    >()
    // MirrorCommands<F> is the shared sugar surface of Mirror and MirrorChild.
    expectTypeOf(om).toMatchTypeOf<MirrorCommands<typeof order>>()
    expectTypeOf(child).toMatchTypeOf<MirrorCommands<typeof fulfilment>>()
  })
})

describe('wire types line up across source → transport → mirror', () => {
  it('createMirrorSource is typed by the projection; the loopback carries the same state type', () => {
    const source = createMirrorSource(wizard, checkoutClient)
    expectTypeOf(source).toEqualTypeOf<MirrorSource<ProjectionOutput<typeof checkoutClient>>>()
    expectTypeOf(source).toEqualTypeOf<MirrorSource<Client>>()
    const loop = createLocalTransport(source)
    expectTypeOf(loop).toEqualTypeOf<Transport<Client>>()
    // Explicit P and inferred transport agree.
    const m = createMirror<typeof checkoutClient>({ transport: loop })
    expectTypeOf(m).toEqualTypeOf<Mirror<typeof checkoutClient>>()
    // A projection of another flow does not fit the wizard.
    const f = defineFlow({ name: 'other', context: z.object({}) })
    const otherFlow = f.steps({ end: f.final() })
    const otherProjection = defineProjection(otherFlow, { expose: {} })
    // @ts-expect-error projection of a different flow
    createMirrorSource(wizard, otherProjection)
  })
  it('Frame / WireCommand / WireAck / parseWireCommand shapes', () => {
    expectTypeOf<Frame<Client>['kind']>().toEqualTypeOf<'snapshot'>()
    expectTypeOf<Frame<Client>['state']>().toEqualTypeOf<Client>()
    expectTypeOf<WireCommand['command']>().toEqualTypeOf<Command>() // string ids on the wire
    expectTypeOf<WireCommand<typeof checkout>['command']>().toEqualTypeOf<
      Command<typeof checkout>
    >()
    expectTypeOf<WireCommand['expectedSeq']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<WireAck['result']>().toEqualTypeOf<CommandResult>()
    const parsed = parseWireCommand(checkout, {})
    if (parsed.ok) {
      expectTypeOf(parsed.value).toEqualTypeOf<WireCommand<typeof checkout>>()
      expectTypeOf(parsed.value.command).toEqualTypeOf<Command<typeof checkout>>()
    } else expectTypeOf(parsed.issues[0]?.message).toEqualTypeOf<string | undefined>()
  })
})
