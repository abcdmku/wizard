/**
 * Type tests — port of the ADR-001 spike (`spikes/id-safety.spike.ts`) to shape (B)
 * `defineFlow(options).steps(defs, { start })`. Every `@ts-expect-error` is an
 * error-location assertion: it sits on the line right above where tsc must report.
 */
import { type } from 'arktype'
import * as v from 'valibot'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import type { RetryPolicy as CompiledRetryPolicy } from '../../src/authoring/compiled'
import { defineFlow } from '../../src/authoring/define-flow'
import type {
  AbortSignalLike,
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  ContextInput,
  Ctx,
  DepsOf,
  DraftOf,
  EventMapOf,
  EventType,
  Flow,
  FlowOutput,
  FlowStep,
  HasKind,
  InputOf,
  KindOf,
  OutputOf,
  PayloadOf,
  RetryPolicy,
  Step,
  StepId,
  StepKind,
  StepTypesOf,
  TaskId,
  ViewId,
  WaitOutput,
} from '../../src/authoring/types'

// ─────────────────────────────────────────────────────────────────────────────
// Case 1 — the plan §2 end-to-end example (adapted per the architecture review)
// ─────────────────────────────────────────────────────────────────────────────

interface CheckoutDeps {
  shipping: {
    createLabel(ctx: { orderId: string; express: boolean }): Promise<{ trackingId: string }>
  }
  inventory: {
    reserve(cartId: string, opts: { signal: AbortSignalLike }): Promise<{ reservationId: string }>
    release(reservationId: string): Promise<void>
  }
  payments: { createIntent(cartId: string, total: number): Promise<{ intentId: string }> }
}

const f = defineFlow({
  name: 'fulfilment',
  context: z.object({
    orderId: z.string(),
    express: z.boolean(),
    trackingId: z.string().optional(),
  }),
  deps: boundary.trusted<Pick<CheckoutDeps, 'shipping'>>(),
})
export const fulfilment = f.steps({
  label: f.task(({ context, deps }) => deps.shipping.createLabel(context), {
    exit: ({ output, update }) => update({ trackingId: output.trackingId }),
    next: 'done',
  }),
  // ADR-001 L1: sibling `steps` cannot be typed per flow; the typed idiom is context.
  done: f.final({ output: ({ context }) => ({ trackingId: context.trackingId }) }),
})

const c = defineFlow({
  name: 'checkout',
  context: z.object({
    cartId: z.string(),
    total: z.number(),
    express: z.boolean().default(false),
    paymentId: z.string().optional(),
    declineReason: z.string().optional(),
  }),
  events: {
    'payment.captured': z.object({ paymentId: z.string(), amount: z.number() }),
    'payment.failed': z.object({ reason: z.string() }),
  },
  deps: boundary.trusted<CheckoutDeps>(),
  onFailure: 'compensate',
})
export const checkout = c.steps(
  {
    shipping: c.view({
      input: z.object({ address: z.string().min(1), express: z.boolean().default(false) }),
      exit: ({ output, update }) => update({ express: output.express }),
      next: 'reserve',
    }),
    reserve: c.task(
      ({ context, deps, signal }) => deps.inventory.reserve(context.cartId, { signal }),
      {
        retry: { attempts: 3, backoff: 'exponential' },
        compensate: ({ output, deps }) => deps.inventory.release(output.reservationId),
        next: 'awaitPayment',
      },
    ),
    awaitPayment: c.wait({
      enter: ({ context, deps }) => deps.payments.createIntent(context.cartId, context.total),
      on: {
        'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
        'payment.failed': ({ payload, update }) => update({ declineReason: payload.reason }),
      },
      timeout: { after: '15m', next: 'expired' },
      next: 'route',
    }),
    route: c.decision({ next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined') }),
    fulfil: c.flow(fulfilment, {
      context: ({ context }) => ({ orderId: context.cartId, express: context.express }),
      deps: ({ deps }) => ({ shipping: deps.shipping }),
      next: 'receipt',
    }),
    receipt: c.final(),
    declined: c.final(),
    expired: c.final(),
  },
  { start: 'shipping' },
)
type CheckoutF = typeof checkout

describe('case 1: end-to-end example', () => {
  it('extracts ids, kinds, context, deps, events and outputs', () => {
    expectTypeOf<StepId<CheckoutF>>().toEqualTypeOf<
      | 'shipping'
      | 'reserve'
      | 'awaitPayment'
      | 'route'
      | 'fulfil'
      | 'receipt'
      | 'declined'
      | 'expired'
    >()
    expectTypeOf<ViewId<CheckoutF>>().toEqualTypeOf<'shipping'>()
    expectTypeOf<TaskId<CheckoutF>>().toEqualTypeOf<'reserve'>()
    expectTypeOf<ChildStepId<CheckoutF>>().toEqualTypeOf<'fulfil'>()
    expectTypeOf<Ctx<CheckoutF>>().toEqualTypeOf<{
      cartId: string
      total: number
      express: boolean
      paymentId?: string | undefined
      declineReason?: string | undefined
    }>()
    expectTypeOf<ContextInput<CheckoutF>>().toEqualTypeOf<{
      cartId: string
      total: number
      express?: boolean | undefined
      paymentId?: string | undefined
      declineReason?: string | undefined
    }>()
    expectTypeOf<DepsOf<CheckoutF>>().toEqualTypeOf<CheckoutDeps>()
    expectTypeOf<EventType<CheckoutF>>().toEqualTypeOf<'payment.captured' | 'payment.failed'>()
    expectTypeOf<PayloadOf<CheckoutF, 'payment.failed'>>().toEqualTypeOf<{ reason: string }>()
    expectTypeOf<InputOf<CheckoutF, 'shipping'>>().toEqualTypeOf<{
      address: string
      express?: boolean | undefined
    }>()
    expectTypeOf<DraftOf<CheckoutF, 'shipping'>>().toEqualTypeOf<{
      address?: string
      express?: boolean | undefined
    }>()
    expectTypeOf<OutputOf<CheckoutF, 'shipping'>>().toEqualTypeOf<{
      address: string
      express: boolean
    }>()
    expectTypeOf<OutputOf<CheckoutF, 'reserve'>>().toEqualTypeOf<{ reservationId: string }>()
    expectTypeOf<OutputOf<CheckoutF, 'awaitPayment'>>().toEqualTypeOf<
      | {
          readonly event: 'payment.captured'
          readonly payload: { paymentId: string; amount: number }
        }
      | { readonly event: 'payment.failed'; readonly payload: { reason: string } }
      | { readonly event: 'timeout' }
    >()
    expectTypeOf<OutputOf<CheckoutF, 'fulfil'>>().toEqualTypeOf<{
      trackingId: string | undefined
    }>()
    expectTypeOf<FlowOutput<typeof fulfilment>>().toEqualTypeOf<{
      trackingId: string | undefined
    }>()
    expectTypeOf<FlowOutput<CheckoutF>>().toEqualTypeOf<undefined>()
    expectTypeOf<ChildFlowOf<CheckoutF, 'fulfil'>>().toEqualTypeOf<typeof fulfilment>()
    // refs captured through string / fn / array / union+null / timeout.next
    expectTypeOf<StepTypesOf<CheckoutF, 'shipping'>['refs']>().toEqualTypeOf<'reserve'>()
    expectTypeOf<StepTypesOf<CheckoutF, 'awaitPayment'>['refs']>().toEqualTypeOf<
      'expired' | 'route'
    >()
    expectTypeOf<StepTypesOf<CheckoutF, 'route'>['refs']>().toEqualTypeOf<'fulfil' | 'declined'>()
    expectTypeOf<StepTypesOf<CheckoutF, 'receipt'>['refs']>().toEqualTypeOf<never>()
    expectTypeOf<KindOf<CheckoutF, 'route'>>().toEqualTypeOf<'decision'>()
  })

  it('hover-quality: a step in Flow.steps is a concrete compact FlowStep; every flow satisfies AnyFlow', () => {
    expectTypeOf(checkout.steps.reserve).toEqualTypeOf<
      FlowStep<never, { reservationId: string }, 'awaitPayment', 'task', never>
    >()
    expectTypeOf(checkout).toMatchTypeOf<AnyFlow>()
    expectTypeOf(fulfilment).toMatchTypeOf<AnyFlow>()
    const full = c.task(
      ({ deps, context, signal }) => deps.inventory.reserve(context.cartId, { signal }),
      {
        next: 'awaitPayment',
      },
    )
    expectTypeOf(full).toEqualTypeOf<
      Step<
        Ctx<CheckoutF>,
        EventMapOf<CheckoutF>,
        CheckoutDeps,
        never,
        { reservationId: string },
        'awaitPayment',
        'task',
        never
      >
    >()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cases 2–5 — id safety in `next` (string / fn) / `timeout.next` / `start`
// ─────────────────────────────────────────────────────────────────────────────

type SmallCtx = { a: string; b: number }
const s = defineFlow({ name: 'small', context: boundary.trusted<SmallCtx>() })
const se = defineFlow({
  name: 'small-events',
  context: boundary.trusted<SmallCtx>(),
  events: { ping: boundary.trusted<{ n: number }>() },
})

export const bad2 = s.steps({
  // @ts-expect-error case 2 — `next: 'typo'` is reported on THIS step's property line
  a: s.view({ next: 'typo' }),
  b: s.final(),
})
export const bad3 = s.steps({
  // @ts-expect-error case 3 — the literal survives through the fn return (`N`), still rejected here
  a: s.decision({ next: () => 'typo' }),
  b: s.final(),
})
export const bad4 = se.steps({
  // @ts-expect-error case 4 — `timeout.next` typo
  a: se.wait({ on: { ping: () => {} }, timeout: { after: '1m', next: 'typo' }, next: 'b' }),
  b: se.final(),
})
export const bad5 = s.steps(
  { a: s.view({ next: 'b' }), b: s.final() },
  // @ts-expect-error case 5 — `start` must be a step id (completions offer 'a' | 'b')
  { start: 'typo' },
)

describe('cases 2–5: no cascade — shape (B) keeps T precise even when the check fails', () => {
  it('StepId and refs stay precise on the failure path', () => {
    expectTypeOf<StepId<typeof bad2>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<StepTypesOf<typeof bad2, 'a'>['refs']>().toEqualTypeOf<'typo'>()
    expectTypeOf<Ctx<typeof bad2>>().toEqualTypeOf<SmallCtx>()
    expectTypeOf<StepId<typeof bad3>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<EventType<typeof bad4>>().toEqualTypeOf<'ping'>()
    expectTypeOf<StepId<typeof bad5>>().toEqualTypeOf<'a' | 'b'>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cases 6–8 — modules (spread), excess properties, context variance
// ─────────────────────────────────────────────────────────────────────────────

const m = defineFlow({ name: 'module', context: boundary.trusted<{ a: string }>() })
export const addressModule = {
  m1: m.view({ input: z.object({ street: z.string() }), next: 'm2' }),
  m2: m.task(({ context }) => Promise.resolve({ ok: context.a.length > 0 }), { next: 'root' }), // refers outside the module
}
export const ok6 = s.steps({ ...addressModule, root: s.view({ next: 'm1' }) }) // superset context accepts a { a } module (case 8 ✓)
describe('case 6: module spread', () => {
  it('composes and keeps outputs', () => {
    expectTypeOf<StepId<typeof ok6>>().toEqualTypeOf<'m1' | 'm2' | 'root'>()
    expectTypeOf<OutputOf<typeof ok6, 'm2'>>().toEqualTypeOf<{ ok: boolean }>()
  })
})
// @ts-expect-error case 6 — `{ ...mod }` alone: 'root' is unresolved; spreads cannot be elaborated per property → error on the argument
export const bad6 = s.steps({ ...addressModule })

export const bad7 = s.steps({
  // @ts-expect-error case 7 — excess property `nxt` inside a constructor
  a: s.view({ nxt: 'b' }),
  b: s.final(),
})

const unrelated = defineFlow({ name: 'unrelated', context: boundary.trusted<{ z: boolean }>() })
export const unrelatedSteps = { u: unrelated.view({ exit: ({ context }) => context.z, next: 'u' }) }
export const bad8 = s.steps({
  // @ts-expect-error case 8 — a step bound to an unrelated context is rejected on its property line
  u: unrelatedSteps.u,
  root: s.final(),
})
const depsMod = defineFlow({
  name: 'deps-module',
  context: boundary.trusted<{ a: string }>(),
  deps: boundary.trusted<{ mailer: { send(to: string): Promise<void> } }>(),
})
export const bad8deps = s.steps({
  // @ts-expect-error case 8 (deps) — module needs `mailer`, this flow provides no deps
  m: depsMod.task(({ deps, context }) => deps.mailer.send(context.a), { next: 'root' }),
  root: s.final(),
})
const evMod = defineFlow({
  name: 'ev-module',
  context: boundary.trusted<{ a: string }>(),
  events: { other: boundary.trusted<{ x: number }>() },
})
export const bad8events = s.steps({
  // @ts-expect-error case 8 (events) — module listens for an event this flow does not declare
  w: evMod.wait({ on: { other: () => {} }, next: 'root' }),
  root: s.final(),
})
const evSubset = defineFlow({ name: 'ev-subset', context: boundary.trusted<{ a: string }>() })
export const ok8events = se.steps({
  w: evSubset.view({ next: 'root' }), // a module without events composes into a flow with events
  root: se.final(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 9 — order (in)dependence with `s.task(run, options)`
// ─────────────────────────────────────────────────────────────────────────────

export const ok9 = s.steps({
  // compensate/next BEFORE anything else — still typed
  t1: s.task(async () => ({ id: 1 }), {
    compensate: ({ output }) => output.id.toFixed(),
    next: ({ output }) => (output.id > 0 ? 't2' : 't3'),
    exit: ({ output }) => output.id,
    retry: { attempts: 2 },
  }),
  // sync run, `next` first, `output` boundary overrides the run return type
  t2: s.task(() => 'raw-json', {
    next: 't3',
    output: z.object({ parsed: z.number() }),
    compensate: ({ output }) => output.parsed,
  }),
  t3: s.final(),
})
describe('case 9: task(run, options) is order independent', () => {
  it('outputs and refs', () => {
    expectTypeOf<OutputOf<typeof ok9, 't1'>>().toEqualTypeOf<{ id: number }>()
    expectTypeOf<OutputOf<typeof ok9, 't2'>>().toEqualTypeOf<{ parsed: number }>()
    expectTypeOf<StepTypesOf<typeof ok9, 't1'>['refs']>().toEqualTypeOf<'t2' | 't3'>()
  })
})
export const bad9 = s.steps({
  t1: s.task(async () => ({ id: 1 }), {
    // @ts-expect-error `output` is `{ id: number }` (not any/unknown): unknown property rejected regardless of order
    compensate: ({ output }) => output.nope,
    next: 't2',
  }),
  t2: s.final(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 10 — `initial` vs `input`; INPUT vs OUTPUT with .default()/.transform()
// ─────────────────────────────────────────────────────────────────────────────

export const ok10 = s.steps({
  form: s.view({
    input: z.object({
      qty: z.string().transform((x) => Number(x)),
      express: z.boolean().default(false),
    }),
    initial: { qty: '1' }, // Partial<INPUT> (string), not the parsed number
    validate: ({ output }) => (output.qty > 0 ? undefined : [{ message: 'qty must be > 0' }]),
    canExit: ({ output }) => output.qty < 100,
    exit: ({ output }) => output.express, // parsed
    next: 'done',
  }),
  done: s.final(),
})
describe('case 10: draft (INPUT) vs output (OUTPUT)', () => {
  it('InputOf/DraftOf are the INPUT side, OutputOf the OUTPUT side', () => {
    expectTypeOf<InputOf<typeof ok10, 'form'>>().toEqualTypeOf<{
      qty: string
      express?: boolean | undefined
    }>()
    expectTypeOf<DraftOf<typeof ok10, 'form'>>().toEqualTypeOf<{
      qty?: string
      express?: boolean | undefined
    }>()
    expectTypeOf<OutputOf<typeof ok10, 'form'>>().toEqualTypeOf<{ qty: number; express: boolean }>()
  })
})
// order inside a view/flow cfg never matters either: `input`/`output` are boundaries (inferred in pass 1)
export const okOrderView = s.steps({
  v: s.view({
    exit: ({ output }) => output.qty.toFixed(),
    next: 'f',
    input: z.object({ qty: z.number() }),
  }),
  f: s.flow(fulfilment, {
    exit: ({ output }) => output.trackingId,
    next: 'done',
    context: ({ context }) => ({ orderId: context.a, express: false }),
  }),
  done: s.final(),
})
describe('case 10b: cfg property order', () => {
  it('view/flow outputs come from boundaries / child flow', () => {
    expectTypeOf<OutputOf<typeof okOrderView, 'v'>>().toEqualTypeOf<{ qty: number }>()
    expectTypeOf<OutputOf<typeof okOrderView, 'f'>>().toEqualTypeOf<{
      trackingId: string | undefined
    }>()
  })
})
export const bad10 = s.steps({
  form: s.view({
    input: z.object({ qty: z.string() }),
    // @ts-expect-error case 10 — `initial` must be a Partial of the schema INPUT (`qty` is a string)
    initial: { qty: 1 },
    next: 'done',
  }),
  done: s.final(),
})
describe('case 10c: no cascade — schema wins', () => {
  it('InputOf is still the schema input', () => {
    expectTypeOf<InputOf<typeof bad10, 'form'>>().toEqualTypeOf<{ qty: string }>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Inputless views (review finding 3): `I` / `O` come from `input` ONLY — `initial` and the
// output-consuming hooks cannot widen them; without `input` a view is I = never, O = undefined.
// ─────────────────────────────────────────────────────────────────────────────

declare const widened: Partial<{ foo: string }>
export const okNoInput = s.steps({
  v: s.view({ next: 'done', exit: ({ output }) => output }),
  done: s.final(),
})
export const badInitialNoInput = s.steps({
  // @ts-expect-error `initial` requires `input` (Partial<never> = never): a widened value is rejected
  v: s.view({ initial: widened, next: 'done' }),
  // @ts-expect-error … so is an explicit object literal
  v2: s.view({ initial: { foo: 'x' }, next: 'done' }),
  done: s.final(),
})
export const badAnnotatedHookNoInput = s.steps({
  // @ts-expect-error an annotated hook parameter cannot invent an output type: `output` is undefined here
  v: s.view({ next: 'done', exit: ({ output }: { output: { foo: string } }) => output.foo }),
  done: s.final(),
})
export const badAnnotatedHookWithInput = s.steps({
  v: s.view({
    input: z.object({ foo: z.string() }),
    // @ts-expect-error the annotation must match the boundary OUTPUT ({ foo: string }), it does not retype it
    exit: ({ output }: { output: { bar: number } }) => output.bar,
    next: 'done',
  }),
  done: s.final(),
})
describe('inputless views', () => {
  it('have no draft and no output, whatever `initial` / hook annotations say', () => {
    expectTypeOf<InputOf<typeof okNoInput, 'v'>>().toEqualTypeOf<never>()
    expectTypeOf<OutputOf<typeof okNoInput, 'v'>>().toEqualTypeOf<undefined>()
    expectTypeOf<InputOf<typeof badInitialNoInput, 'v'>>().toEqualTypeOf<never>()
    expectTypeOf<OutputOf<typeof badInitialNoInput, 'v'>>().toEqualTypeOf<undefined>()
    expectTypeOf<OutputOf<typeof badInitialNoInput, 'v2'>>().toEqualTypeOf<undefined>()
    expectTypeOf<OutputOf<typeof badAnnotatedHookNoInput, 'v'>>().toEqualTypeOf<undefined>()
    expectTypeOf<OutputOf<typeof badAnnotatedHookWithInput, 'v'>>().toEqualTypeOf<{ foo: string }>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Decision output (ADR-001 amendment): the normalized list of chosen targets.
// ─────────────────────────────────────────────────────────────────────────────

describe('decision output', () => {
  it('is readonly N[] over the ids the decision may choose', () => {
    expectTypeOf<OutputOf<CheckoutF, 'route'>>().toEqualTypeOf<readonly ('fulfil' | 'declined')[]>()
    const d = s.decision({ next: () => (Math.random() > 0.5 ? 'a' : ['a', 'b']) })
    expectTypeOf<NonNullable<(typeof d)['~types']>['output']>().toEqualTypeOf<
      readonly ('a' | 'b')[]
    >()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Kind filters (review finding 13): a partially widened kind is not any of its members; the fully
// widened `StepKind` (a wildcard flow) still counts as every kind.
// ─────────────────────────────────────────────────────────────────────────────

declare const widenedKinds: Flow<
  { n: number },
  { n: number },
  {},
  unknown,
  {
    readonly either: FlowStep<never, undefined, 'v', 'view' | 'task', never>
    readonly wild: FlowStep<never, undefined, 'v', StepKind, never>
    readonly v: FlowStep<never, undefined, never, 'view', never>
    readonly t: FlowStep<never, number, never, 'task', never>
    readonly f: FlowStep<never, string, never, 'final', never>
  }
>
describe('kind filters', () => {
  it("exclude 'view' | 'task' steps, include StepKind wildcards", () => {
    expectTypeOf<ViewId<typeof widenedKinds>>().toEqualTypeOf<'wild' | 'v'>()
    expectTypeOf<TaskId<typeof widenedKinds>>().toEqualTypeOf<'wild' | 't'>()
    expectTypeOf<FlowOutput<typeof widenedKinds>>().toEqualTypeOf<string | undefined>()
    expectTypeOf<HasKind<typeof widenedKinds, 'either', 'view'>>().toEqualTypeOf<false>()
    expectTypeOf<HasKind<typeof widenedKinds, 'wild', 'final'>>().toEqualTypeOf<true>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 11 — Zod 4 / Valibot / ArkType / boundary.guard / trusted / parse all infer
// ─────────────────────────────────────────────────────────────────────────────

const isUser = (x: unknown): x is { id: string } => typeof x === 'object' && x !== null && 'id' in x
const b11 = defineFlow({
  name: 'boundaries',
  context: v.object({ locale: v.string(), total: v.optional(v.number(), 0) }), // valibot default → input ≠ output
  events: {
    zod: z.object({ a: z.string() }),
    vali: v.object({ b: v.number() }),
    ark: type({ c: 'boolean' }),
    guard: boundary.guard(isUser),
    trusted: boundary.trusted<{ e: Date }>(),
    parse: boundary.parse((x) => String(x)),
  },
  deps: boundary.trusted<{ log: (m: string) => void }>(),
})
export const ok11 = b11.steps({
  ark: b11.view({
    input: type({ name: 'string', age: 'number' }),
    exit: ({ output, deps }) => deps.log(output.name.toUpperCase()),
    next: 'vali',
  }),
  vali: b11.view({ input: v.object({ email: v.pipe(v.string(), v.email()) }), next: 'guarded' }),
  guarded: b11.view({
    input: boundary.guard(isUser),
    exit: ({ output }) => output.id,
    next: 'trusted',
  }),
  trusted: b11.view({
    input: boundary.trusted<{ note: string }>(),
    initial: { note: '' },
    next: 'ev',
  }),
  ev: b11.wait({
    on: {
      zod: ({ payload, deps }) => deps.log(payload.a),
      vali: ({ payload, deps }) => deps.log(payload.b.toFixed()),
      ark: ({ payload, deps }) => deps.log(String(payload.c)),
      guard: ({ payload, deps }) => deps.log(payload.id),
      trusted: ({ payload, deps }) => deps.log(String(payload.e.getTime())),
      parse: ({ payload, deps }) => deps.log(payload.toUpperCase()),
    },
    next: 'done',
  }),
  done: b11.final({ output: ({ context }) => context.total }),
})
type Ok11 = typeof ok11
describe('case 11: boundary inference', () => {
  it('context, inputs, events, deps and flow output infer from every boundary style', () => {
    expectTypeOf<Ctx<Ok11>>().toEqualTypeOf<{ locale: string; total: number }>()
    expectTypeOf<ContextInput<Ok11>>().toEqualTypeOf<{
      locale: string
      total?: number | undefined
    }>()
    expectTypeOf<OutputOf<Ok11, 'ark'>>().toEqualTypeOf<{ name: string; age: number }>()
    expectTypeOf<OutputOf<Ok11, 'vali'>>().toEqualTypeOf<{ email: string }>()
    expectTypeOf<OutputOf<Ok11, 'guarded'>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<InputOf<Ok11, 'trusted'>>().toEqualTypeOf<{ note: string }>()
    expectTypeOf<PayloadOf<Ok11, 'ark'>>().toEqualTypeOf<{ c: boolean }>()
    expectTypeOf<PayloadOf<Ok11, 'parse'>>().toEqualTypeOf<string>()
    expectTypeOf<EventType<Ok11>>().toEqualTypeOf<
      'zod' | 'vali' | 'ark' | 'guard' | 'trusted' | 'parse'
    >()
    expectTypeOf<FlowOutput<Ok11>>().toEqualTypeOf<number>()
    expectTypeOf<DepsOf<Ok11>>().toEqualTypeOf<{ log: (m: string) => void }>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wait steps — output is the union over ALL flow events (+ timeout); on/timeout/next any order
// ─────────────────────────────────────────────────────────────────────────────

const w = defineFlow({
  name: 'waits',
  context: boundary.trusted<SmallCtx>(),
  events: { e1: boundary.trusted<{ x: number }>(), e2: boundary.trusted<{ y: string }>() },
})
export const okWait = w.steps({
  w: w.wait({
    next: ({ output }) => (output.event === 'e1' ? (output.payload.x > 0 ? 'done' : 'w2') : 'w2'),
    timeout: { after: 3000, next: 'done' },
    on: { e1: ({ payload }) => ({ next: payload.x > 1 ? 'done' : undefined }) }, // handler-returned target is captured too
  }),
  w2: w.wait({
    on: { e2: ({ payload, update }) => update({ a: payload.y }) },
    exit: ({ output }) => output.event, // 'e1' | 'e2' — no timeout declared, no timeout marker
    next: 'done',
  }),
  done: w.final(),
})
describe('wait output', () => {
  it('is the union over all events, plus the timeout marker only when the step declares timeout; refs include handler targets', () => {
    expectTypeOf<OutputOf<typeof okWait, 'w'>>().toEqualTypeOf<
      | { readonly event: 'e1'; readonly payload: { x: number } }
      | { readonly event: 'e2'; readonly payload: { y: string } }
      | { readonly event: 'timeout' }
    >()
    expectTypeOf<OutputOf<typeof okWait, 'w2'>>().toEqualTypeOf<
      | { readonly event: 'e1'; readonly payload: { x: number } }
      | { readonly event: 'e2'; readonly payload: { y: string } }
    >()
    expectTypeOf<StepTypesOf<typeof okWait, 'w'>['refs']>().toEqualTypeOf<'done' | 'w2'>()
    // The generic `WaitOutput<Ev>` (unknown phantom) keeps the marker: it is "any wait step".
    expectTypeOf<WaitOutput<{ e1: { x: number } }>>().toEqualTypeOf<
      { readonly event: 'e1'; readonly payload: { x: number } } | { readonly event: 'timeout' }
    >()
  })
  it('hooks of a wait without timeout never see the marker', () => {
    w.wait({
      on: { e1: () => {} },
      // @ts-expect-error `output.event` is 'e1' | 'e2' here: comparing with 'timeout' has no overlap
      exit: ({ output }) => output.event === 'timeout',
      next: 'done',
    })
  })
})
export const badWait = w.steps({
  w: w.wait({
    // @ts-expect-error unknown event name in `on` (excess property on a concrete mapped type)
    on: { e3: () => {} },
    next: 'done',
  }),
  done: w.final(),
})
export const badWaitArrayNext = w.steps({
  // @ts-expect-error a handler's `next` override is a single id (what the runtime supports), not a list: refs widen to string
  w: w.wait({
    on: {
      // @ts-expect-error … and the handler's return type itself is rejected
      e1: () => ({ next: ['done', 'w2'] }),
    },
    next: 'done',
  }),
  w2: w.final(),
  done: w.final(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Negative tests from the review: dynamic keys, duplicate keys across a spread, widened `next`
// ─────────────────────────────────────────────────────────────────────────────

declare const dyn: string
// @ts-expect-error computed/dynamic key → index signature → rejected by NoDynamicKeys (error on the argument)
export const badDynamic = s.steps({ [dyn]: s.view({ next: 'x' }), b: s.final() })
const K = 'lit' as const
export const okComputedLiteral = s.steps({ [K]: s.view({ next: 'b' }), b: s.final() }) // computed LITERAL keys are fine
describe('computed literal keys', () => {
  it('are literal ids', () => {
    expectTypeOf<StepId<typeof okComputedLiteral>>().toEqualTypeOf<'lit' | 'b'>()
  })
})
export const dupOverwritten = s.steps({
  // @ts-expect-error TS2783: 'm1' is specified more than once, so this usage will be overwritten by the spread
  m1: s.view({ next: 'root' }),
  ...addressModule,
  root: s.view({ next: 'm1' }),
})
// `{ ...addressModule, m1: s.view(...) }` (explicit AFTER spread) compiles — the explicit key wins silently;
// the runtime (compile.ts) still validates ids.
export const dupExplicitWins = s.steps({
  ...addressModule,
  m1: s.view({ next: 'root' }),
  root: s.view({ next: 'm1' }),
})
describe('duplicate keys across a spread', () => {
  it('explicit key wins', () => {
    expectTypeOf<KindOf<typeof dupExplicitWins, 'm1'>>().toEqualTypeOf<'view'>()
  })
})
declare const someString: string
export const badWidened = s.steps({
  // @ts-expect-error `next` returning a widened `string` is rejected (refs: string ⊄ ids)
  a: s.decision({ next: ({ context }) => context.a }),
  // @ts-expect-error `next: string` variable is rejected
  b: s.view({ next: someString }),
  c: s.final(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Definition header: `name` required, hooks typed, `dependsOn` ids checked
// ─────────────────────────────────────────────────────────────────────────────

// @ts-expect-error `name` is required (persistence identity)
export const _nameRequired = defineFlow({ context: boundary.trusted<SmallCtx>() })
export const badDeps = s.steps({
  a: s.task(async () => 1, { next: 'b' }),
  // @ts-expect-error `dependsOn: ['nope']` — unknown id
  b: s.task(async () => 2, { dependsOn: ['nope'] }),
  c: s.final(),
})
export const okDeps = s.steps({
  a: s.task(async () => 1, { next: ['b', 'c'] }),
  b: s.task(async () => 2, { next: 'join' }),
  c: s.task(async () => 3, { next: 'join' }),
  join: s.task(async () => 4, { dependsOn: ['b', 'c'], next: 'anyJoin' }),
  anyJoin: s.task(async () => 5, { dependsOn: { any: ['b', 'c'] }, next: 'done' }),
  done: s.final(),
})
describe('dependsOn', () => {
  it('captures ids into refs', () => {
    expectTypeOf<StepTypesOf<typeof okDeps, 'join'>['refs']>().toEqualTypeOf<
      'b' | 'c' | 'anyJoin'
    >()
    expectTypeOf<StepTypesOf<typeof okDeps, 'a'>['refs']>().toEqualTypeOf<'b' | 'c'>()
  })
})

// A hand-written Flow type is assignable to AnyFlow only when its steps are FlowSteps.
declare const handFlow: Flow<
  { n: number },
  { n: number },
  {},
  unknown,
  {
    readonly a: FlowStep<never, undefined, 'b', 'view', never>
    readonly b: FlowStep<never, undefined, never, 'final', never>
  }
>
describe('AnyFlow', () => {
  it('accepts hand-written flows and exposes string ids for AnyFlow itself', () => {
    expectTypeOf(handFlow).toMatchTypeOf<AnyFlow>()
    expectTypeOf<StepId<AnyFlow>>().toEqualTypeOf<string>()
    expectTypeOf<ViewId<AnyFlow>>().toEqualTypeOf<string>()
    expectTypeOf<EventType<AnyFlow>>().toEqualTypeOf<string>()
    expectTypeOf<ViewId<typeof handFlow>>().toEqualTypeOf<'a'>()
  })
})

// One RetryPolicy shape for the DSL and the machine: `backoff` is a fixed number of ms or
// 'exponential' (+ baseMs / factor / maxBackoffMs); the old `delay` / 'fixed' form is gone.
const r = defineFlow({ name: 'retry', context: boundary.trusted<{}>() })
describe('RetryPolicy', () => {
  it('is the machine shape (attempts, backoff: number | exponential, baseMs, factor, maxBackoffMs)', () => {
    expectTypeOf<RetryPolicy>().toEqualTypeOf<CompiledRetryPolicy>()
    r.task(() => 1, { retry: { attempts: 3, backoff: 100 } })
    r.task(() => 1, {
      retry: { attempts: 3, backoff: 'exponential', baseMs: 50, factor: 3, maxBackoffMs: 5_000 },
    })
    // @ts-expect-error `delay` is not a field: use `backoff: <ms>`
    r.task(() => 1, { retry: { attempts: 3, delay: 100 } })
    // @ts-expect-error `'fixed'` is not a backoff: use a number of ms
    r.task(() => 1, { retry: { attempts: 3, backoff: 'fixed' } })
    // @ts-expect-error `maxDelay` is not a field: use `maxBackoffMs`
    defineFlow({ name: 'x', context: boundary.trusted<{}>(), retry: { attempts: 1, maxDelay: 5 } })
  })
})
