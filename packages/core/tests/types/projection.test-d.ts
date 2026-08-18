/**
 * Type tests — deny-by-default projections (ADR-001 case 12) and nesting depth (R5).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import type {
  AnyFlow,
  Flow,
  FlowOutput,
  FlowStep,
  Issue,
  SerializedError,
} from '../../src/authoring/types'
import {
  type ChildSummary,
  type ClientState,
  type ClientStateFallback,
  defineProjection,
  type ProjectionOutput,
} from '../../src/projection/define-projection'
import type { Wizard } from '../../src/wizard/create-wizard'

// ─────────────────────────────────────────────────────────────────────────────
// Case 12 — the projected TYPE reflects exactly what is exposed
// ─────────────────────────────────────────────────────────────────────────────

const f = defineFlow({
  name: 'fulfilment',
  context: z.object({ orderId: z.string(), trackingId: z.string().optional() }),
})
const fulfilment = f.steps({
  label: f.task(async () => ({ trackingId: 'x' }), {
    exit: ({ output, update }) => update({ trackingId: output.trackingId }),
    next: 'done',
  }),
  done: f.final({ output: ({ context }) => ({ trackingId: context.trackingId }) }),
})

const c = defineFlow({
  name: 'checkout',
  context: z.object({
    cartId: z.string(),
    total: z.number(),
    express: z.boolean().default(false),
    secret: z.string(),
  }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
})
const checkout = c.steps(
  {
    shipping: c.view({
      input: z.object({ address: z.string(), express: z.boolean().default(false) }),
      next: 'reserve',
    }),
    reserve: c.task(async () => ({ reservationId: 'r' }), { next: 'fulfil' }),
    fulfil: c.flow(fulfilment, {
      context: ({ context }) => ({ orderId: context.cartId }),
      next: 'receipt',
    }),
    receipt: c.final(),
  },
  { start: 'shipping' },
)
export const checkoutClient = defineProjection(checkout, {
  expose: {
    steps: {
      shipping: { input: true, issues: true },
      reserve: { error: true },
      fulfil: { output: true, child: true },
    },
    context: ['total', 'express'],
    output: true,
  },
})
type ClientCheckout = ProjectionOutput<typeof checkoutClient>

describe('case 12: ClientState<F, expose>', () => {
  it('picks exactly the exposed context keys and step fields; unexposed fields are absent (not optional)', () => {
    expectTypeOf<ClientCheckout['context']>().toEqualTypeOf<{ total: number; express: boolean }>()
    expectTypeOf<keyof ClientCheckout['steps']['shipping']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt' | 'issues' | 'input'
    >()
    expectTypeOf<ClientCheckout['steps']['shipping']['input']>().toEqualTypeOf<
      { address?: string; express?: boolean | undefined } | undefined
    >()
    expectTypeOf<ClientCheckout['steps']['shipping']['issues']>().toEqualTypeOf<
      readonly Issue[] | undefined
    >()
    expectTypeOf<keyof ClientCheckout['steps']['fulfil']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt' | 'output' | 'child'
    >()
    expectTypeOf<ClientCheckout['steps']['fulfil']['output']>().toEqualTypeOf<
      { trackingId: string | undefined } | undefined
    >()
    // `child: true` = the compact summary, not the nested projected state
    expectTypeOf<ClientCheckout['steps']['fulfil']['child']>().toEqualTypeOf<
      ChildSummary | undefined
    >()
    expectTypeOf<keyof ClientCheckout['steps']['reserve']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt' | 'error'
    >()
    expectTypeOf<ClientCheckout['steps']['reserve']['error']>().toEqualTypeOf<
      SerializedError | undefined
    >()
    expectTypeOf<ClientCheckout['steps']['reserve']['id']>().toEqualTypeOf<'reserve'>()
    expectTypeOf<ClientCheckout['steps']['reserve']['kind']>().toEqualTypeOf<'task'>()
    expectTypeOf<keyof ClientCheckout['steps']['receipt']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt'
    >()
    expectTypeOf<ClientCheckout['current']>().toEqualTypeOf<'shipping' | null>()
    expectTypeOf<ClientCheckout['output']>().toEqualTypeOf<
      FlowOutput<typeof checkout> | undefined
    >()
    expectTypeOf<ClientCheckout['seq']>().toEqualTypeOf<number>()
    expectTypeOf<ClientCheckout['instanceId']>().toEqualTypeOf<string>()
  })
  it('a projection with no exposure exposes nothing but the base facts: no flow output, issues, errors or children', () => {
    const bare = defineProjection(checkout, { expose: {} })
    type Bare = ProjectionOutput<typeof bare>
    expectTypeOf<Bare['context']>().toEqualTypeOf<{}>()
    expectTypeOf<keyof Bare>().toEqualTypeOf<
      'instanceId' | 'epoch' | 'seq' | 'status' | 'current' | 'context' | 'steps'
    >()
    expectTypeOf<keyof Bare['steps']['shipping']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt'
    >()
    expectTypeOf<keyof Bare['steps']['fulfil']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt'
    >()
    const bareState = {} as Bare
    // @ts-expect-error the flow output is not exposed
    bareState.output
    // @ts-expect-error issues are not exposed
    bareState.steps.shipping.issues
    // @ts-expect-error errors are not exposed
    bareState.steps.reserve.error
    // @ts-expect-error children are not exposed
    bareState.steps.fulfil.child
  })
  it('a projection of a same-name, same-shape flow is type-compatible (identity is a runtime check)', () => {
    const t = defineFlow({
      name: 'checkout',
      context: z.object({
        cartId: z.string(),
        total: z.number(),
        express: z.boolean().default(false),
        secret: z.string(),
      }),
      events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    })
    const twin = t.steps(
      {
        shipping: t.view({
          input: z.object({ address: z.string(), express: z.boolean().default(false) }),
          next: 'reserve',
        }),
        reserve: t.task(async () => ({ reservationId: 'r' }), { next: 'fulfil' }),
        fulfil: t.flow(fulfilment, {
          context: ({ context }) => ({ orderId: context.cartId }),
          next: 'receipt',
        }),
        receipt: t.final(),
      },
      { start: 'shipping' },
    )
    const twinProjection = defineProjection(twin, { expose: {} })
    const wizard = {} as Wizard<typeof checkout>
    // Compiles (structural types) — `wizard.project` throws DEFINITION_INVALID at runtime.
    wizard.project(twinProjection)
    expectTypeOf(twinProjection.flow).toEqualTypeOf<typeof twin>()
  })
})
export const badExpose = defineProjection(checkout, {
  // @ts-expect-error unknown step id in `expose.steps`
  expose: { steps: { typo: { input: true } } },
})
export const badExposeCtx = defineProjection(checkout, {
  // @ts-expect-error unknown context key
  expose: { context: ['nope'] },
})
export const badExposeChild = defineProjection(checkout, {
  // @ts-expect-error `child` exposure is only valid on flow steps
  expose: { steps: { reserve: { child: {} } } },
})
export const badExposeOutput = defineProjection(checkout, {
  // @ts-expect-error `output` is a boolean
  expose: { output: 'yes' },
})
export const okExposeChild = defineProjection(checkout, {
  expose: {
    steps: {
      fulfil: { output: true, child: { steps: { label: { output: true } }, context: ['orderId'] } },
    },
  },
})
describe('nested exposure', () => {
  it('types the child ClientState from the child flow (deny-by-default inside too)', () => {
    type Child = NonNullable<ProjectionOutput<typeof okExposeChild>['steps']['fulfil']['child']>
    expectTypeOf<Child['context']>().toEqualTypeOf<{ orderId: string }>()
    expectTypeOf<Child['steps']['label']['output']>().toEqualTypeOf<
      { trackingId: string } | undefined
    >()
    expectTypeOf<keyof Child['steps']['done']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt'
    >()
    expectTypeOf<keyof Child>().toEqualTypeOf<
      'instanceId' | 'epoch' | 'seq' | 'status' | 'current' | 'context' | 'steps'
    >()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R5 — nested depth 1..8 typed through ClientState; the 9th level hits the fallback
// ─────────────────────────────────────────────────────────────────────────────

const leafCtx = boundary.trusted<{ n: number }>()
const d0 = defineFlow({ name: 'deep0', context: leafCtx })
export const deep0 = d0.steps({
  v: d0.view({ next: 'end' }),
  end: d0.final({ output: ({ context }) => context.n }),
})
// nest() is a declared shortcut equivalent to defineFlow({...}).steps({ child: s.flow(child, {...}), end: s.final(...) })
declare function nest<CF extends AnyFlow>(
  child: CF,
): Flow<
  { n: number },
  { n: number },
  {},
  unknown,
  {
    readonly child: FlowStep<never, FlowOutput<CF>, 'end', 'flow', CF>
    readonly end: FlowStep<never, number, never, 'final', never>
  }
>
export const deep1 = nest(deep0)
export const deep2 = nest(deep1)
export const deep3 = nest(deep2)
export const deep4 = nest(deep3)
export const deep5 = nest(deep4)
export const deep6 = nest(deep5)
export const deep7 = nest(deep6)
export const deep8 = nest(deep7)
const dr = defineFlow({ name: 'deepReal', context: leafCtx })
export const deepReal = dr.steps({
  child: dr.flow(deep8, { context: ({ context }) => ({ n: context.n }), next: 'end' }),
  end: dr.final(),
})
type ExposeChild<Inner> = {
  readonly steps: { readonly child: { readonly output: true; readonly child: Inner } }
}
type E0 = { readonly steps: { readonly v: { readonly input: true } } }
type E1 = ExposeChild<E0>
type E2 = ExposeChild<E1>
type E3 = ExposeChild<E2>
type E4 = ExposeChild<E3>
type E5 = ExposeChild<E4>
type E6 = ExposeChild<E5>
type E7 = ExposeChild<E6>
type E8 = ExposeChild<E7>
type CS8 = ClientState<typeof deep8, E8>
type L1 = NonNullable<CS8['steps']['child']['child']>
type L2 = NonNullable<L1['steps']['child']['child']>
type L3 = NonNullable<L2['steps']['child']['child']>
type L4 = NonNullable<L3['steps']['child']['child']>
type L5 = NonNullable<L4['steps']['child']['child']>
type L6 = NonNullable<L5['steps']['child']['child']>
type L7 = NonNullable<L6['steps']['child']['child']>
type L8 = NonNullable<L7['steps']['child']['child']>
type CS9 = ClientState<typeof deepReal, ExposeChild<E8>>
type M1 = NonNullable<CS9['steps']['child']['child']>
type M2 = NonNullable<M1['steps']['child']['child']>
type M3 = NonNullable<M2['steps']['child']['child']>
type M4 = NonNullable<M3['steps']['child']['child']>
type M5 = NonNullable<M4['steps']['child']['child']>
type M6 = NonNullable<M5['steps']['child']['child']>
type M7 = NonNullable<M6['steps']['child']['child']>
type M8 = NonNullable<M7['steps']['child']['child']>
type M9 = NonNullable<M8['steps']['child']['child']>
describe('nesting depth budget (8 child edges below the root)', () => {
  it('child levels 1–8 are precise, level 9 is the fallback (the root does not consume the budget)', () => {
    // deep8 as the root: its 8 nested children (deep7 … deep0) are all precise.
    expectTypeOf<CS8['steps']['child']['output']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<L7['steps']['child']['output']>().toEqualTypeOf<number | undefined>() // deep1 (7 child levels below the root)
    expectTypeOf<L8['steps']['v']['input']>().toEqualTypeOf<never | undefined>() // deep0 (8 child levels below the root) is still precise
    expectTypeOf<L8['context']>().toEqualTypeOf<{}>()
    // deepReal as the root (deep8 = level 1 … deep0 = level 9): the 9th child level is the fallback.
    expectTypeOf<M8['steps']['child']['output']>().toEqualTypeOf<number | undefined>() // deep1 (level 8)
    expectTypeOf<M9>().toEqualTypeOf<ClientStateFallback>() // deep0 (level 9)
  })
  it('a real 2-level defineProjection is typed', () => {
    const deepProjection = defineProjection(deepReal, {
      expose: { steps: { child: { output: true, child: { steps: { child: { output: true } } } } } },
    })
    expectTypeOf<
      NonNullable<
        ProjectionOutput<typeof deepProjection>['steps']['child']['child']
      >['steps']['child']['output']
    >().toEqualTypeOf<number | undefined>()
  })
})
