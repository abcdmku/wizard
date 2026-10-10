/**
 * Type tests — v0.2 authoring surface (plan §9): `on` on every kind with the per-kind return
 * contract, flow-level `on` and `correlate`, `when`, `idempotent`, `mapError` → `ErrorOf`,
 * `StepState.error.data`. Every `@ts-expect-error` is an error-location assertion.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import type {
  AnyFlow,
  BaseArgs,
  ErrorOf,
  EventArgs,
  FlowOnArgs,
  FlowStep,
  MapErrorArgs,
  RunArgs,
  StepId,
  StepTypesOf,
} from '../../src/authoring/types'
import type { StepErrorOf, StepState, Wizard } from '../../src/wizard/create-wizard'

interface Deps {
  ledger: { post(id: string): Promise<{ ref: string }> }
}
const s = defineFlow({
  name: 'v02',
  context: z.object({
    id: z.string(),
    note: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  events: {
    'note.added': z.object({ text: z.string() }),
    'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
  },
  deps: boundary.trusted<Deps>(),
  // Flow-level handlers: typed args, `{ cancel }` or nothing.
  on: {
    'note.added': ({ payload, update, context, deps, path, event }) => {
      expectTypeOf(payload).toEqualTypeOf<{ text: string }>()
      expectTypeOf(context).toEqualTypeOf<{
        id: string
        note?: string | undefined
        cancelled?: boolean | undefined
      }>()
      expectTypeOf(deps).toEqualTypeOf<Deps>()
      expectTypeOf(path).toEqualTypeOf<readonly string[]>()
      expectTypeOf(event).toEqualTypeOf<'note.added'>()
      update({ note: payload.text })
    },
    'order.cancelled': ({ payload }) => ({ cancel: payload.reason }),
  },
  correlate: {
    'order.cancelled': (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ orderId: string; reason: string }>()
      return payload.orderId
    },
  },
})

interface LedgerFailure {
  code: 'LEDGER_DOWN' | 'REJECTED'
  attempt: number
}

export const flow = s.steps(
  {
    // view: `on` may move the cursor with `{ next }`; `when` gets BaseArgs.
    review: s.view({
      input: z.object({ ok: z.boolean() }),
      on: {
        'note.added': ({ payload, update }) => {
          update({ note: payload.text })
          return { next: 'post' }
        },
      },
      when: (args) => {
        expectTypeOf(args).toEqualTypeOf<
          BaseArgs<{ id: string; note?: string | undefined; cancelled?: boolean | undefined }, Deps>
        >()
        return args.context.note !== 'skip-review'
      },
      next: 'post',
    }),
    // task: `on` returns nothing; `idempotent` + `mapError` → ErrorOf
    post: s.task(({ deps, context }) => deps.ledger.post(context.id), {
      on: { 'note.added': ({ payload, update }) => update({ note: payload.text }) },
      idempotent: ({ context, attempt }) => `${context.id}#${attempt}`,
      mapError: (error, args): LedgerFailure => {
        expectTypeOf(error).toEqualTypeOf<unknown>()
        expectTypeOf(args).toEqualTypeOf<
          MapErrorArgs<
            { id: string; note?: string | undefined; cancelled?: boolean | undefined },
            Deps
          >
        >()
        expectTypeOf(args.attempt).toEqualTypeOf<number>()
        return { code: error instanceof Error ? 'LEDGER_DOWN' : 'REJECTED', attempt: args.attempt }
      },
      when: ({ context }) => context.cancelled !== true,
      next: 'route',
    }),
    // async mapError: E is the awaited value
    plain: s.task(async () => 1, {
      mapError: async () => ({ reason: 'x' }),
      idempotent: true,
      next: 'route',
    }),
    // decision / flow / final: `on` returns nothing, `when` on the decision
    route: s.decision({
      on: { 'note.added': () => {} },
      when: () => true,
      next: () => 'done',
    }),
    // wait: `{ keep: true }` and `{ next }` (unchanged) — a handler-returned target is captured
    hold: s.wait({
      on: {
        'note.added': ({ payload }) =>
          payload.text === 'wait' ? { keep: true } : { next: 'done' },
      },
      when: () => true,
      next: 'done',
    }),
    done: s.final({ on: { 'note.added': () => {} } }),
  },
  { start: 'review' },
)
type F = typeof flow
declare const wizard: Wizard<F>

describe('§9.1 `on` on every kind: per-kind return contract', () => {
  it('a task / decision / flow / final handler must return void — `{ next }` is rejected', () => {
    s.task(async () => 1, {
      on: {
        // @ts-expect-error a task handler cannot redirect
        'note.added': () => ({ next: 'done' }),
      },
    })
    s.decision({
      next: () => null,
      on: {
        // @ts-expect-error a decision handler cannot redirect
        'note.added': () => ({ next: 'done' }),
      },
    })
    s.final({
      on: {
        // @ts-expect-error a final handler cannot redirect
        'note.added': () => ({ next: 'done' }),
      },
    })
    // Returning `undefined` / a Promise<void> is fine.
    s.task(async () => 1, { on: { 'note.added': async () => {} } })
  })
  it('a view handler may return `{ next }` (captured into refs) but not `{ keep }`', () => {
    expectTypeOf<StepTypesOf<F, 'review'>['refs']>().toEqualTypeOf<'post'>()
    s.view({
      on: {
        // @ts-expect-error `keep` is a wait-only result
        'note.added': () => ({ keep: true }),
      },
    })
    const bad = s.steps({
      // @ts-expect-error a handler's `{ next }` must be a step id (error on the step's property line)
      v: s.view({ on: { 'note.added': () => ({ next: 'typo' }) } }),
      end: s.final(),
    })
    expectTypeOf<StepId<typeof bad>>().toEqualTypeOf<'v' | 'end'>()
  })
  it('a wait handler may return `{ keep: true }` or `{ next }`; refs include handler targets', () => {
    expectTypeOf<StepTypesOf<F, 'hold'>['refs']>().toEqualTypeOf<'done'>()
    s.wait({
      on: {
        // @ts-expect-error `keep` must be `true`
        'note.added': () => ({ keep: false }),
      },
    })
  })
  it('handler args are typed per event (payload, event name, context, deps)', () => {
    s.task(async () => 1, {
      on: {
        'order.cancelled': (a) => {
          expectTypeOf(a).toEqualTypeOf<
            EventArgs<
              { id: string; note?: string | undefined; cancelled?: boolean | undefined },
              Deps,
              { orderId: string; reason: string },
              'order.cancelled'
            >
          >()
        },
        // @ts-expect-error unknown event name in `on`
        'nope.event': () => {},
      },
    })
  })
})

describe('§9.1 flow-level `on` and `correlate`', () => {
  it('flow-level handlers return void or `{ cancel }`; `{ next }` is rejected; args are FlowOnArgs (no `step`)', () => {
    defineFlow({
      name: 'bad-on',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>() },
      on: {
        // @ts-expect-error a flow-level handler cannot redirect
        ping: () => ({ next: 'x' }),
      },
    })
    defineFlow({
      name: 'bad-on-2',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>() },
      on: {
        ping: (a) => {
          expectTypeOf(a).toEqualTypeOf<FlowOnArgs<{ a: string }, unknown, { n: number }, 'ping'>>()
          // @ts-expect-error a flow-level handler belongs to no step
          a.step
          return { cancel: `n=${a.payload.n}` }
        },
        // @ts-expect-error unknown event name in flow-level `on`
        pong: () => {},
      },
    })
    // `Ev` still comes from `events` only (NoInfer): a partial `on` / `correlate` never narrows it.
    const partial = defineFlow({
      name: 'partial',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>(), pong: boundary.trusted<{ s: string }>() },
      on: { ping: () => {} },
      correlate: { pong: (p) => p.s },
    })
    const pf = partial.steps({
      w: partial.wait({ on: { pong: () => {} }, next: 'e' }),
      e: partial.final(),
    })
    expectTypeOf<keyof NonNullable<(typeof pf)['~types']>['events']>().toEqualTypeOf<
      'ping' | 'pong'
    >()
  })
  it('correlate extractors get the parsed payload and return string | undefined', () => {
    defineFlow({
      name: 'bad-correlate',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>() },
      correlate: {
        // @ts-expect-error must return a string (or undefined)
        ping: (p) => p.n,
      },
    })
    defineFlow({
      name: 'bad-correlate-2',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>() },
      correlate: {
        // @ts-expect-error unknown event name in `correlate`
        pong: () => 'x',
      },
    })
    defineFlow({
      name: 'ok-correlate',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number; id?: string }>() },
      correlate: { ping: (p) => p.id },
    })
  })
  it('the flow object carries opaque `on` / `correlate` and still satisfies AnyFlow', () => {
    expectTypeOf(flow).toMatchTypeOf<AnyFlow>()
    expectTypeOf(flow.on).toMatchTypeOf<
      { readonly [E in 'note.added' | 'order.cancelled']?: (args: never) => unknown } | undefined
    >()
  })
})

describe('§9.2 `when`', () => {
  it('is accepted on every non-final kind, rejected on finals, and typed with BaseArgs', () => {
    s.view({ when: ({ context, deps }) => context.id.length > 0 && deps !== undefined })
    s.task(async () => 1, { when: async () => true })
    s.wait({ on: { 'note.added': () => {} }, when: () => true })
    s.decision({ next: () => null, when: () => false })
    s.flow(flow, { context: () => ({ id: 'x' }), when: () => true })
    // @ts-expect-error a final step has no `when`
    s.final({ when: () => true })
    // @ts-expect-error `when` must return a boolean (or a promise of one)
    s.task(async () => 1, { when: () => 'yes' })
  })
})

describe('§9.4 / §9.7 `idempotent`, `mapError` → ErrorOf', () => {
  it('idempotent is `true` or a key function of the run args', () => {
    s.task(async () => 1, { idempotent: true })
    s.task(async () => 1, {
      idempotent: (a) => {
        expectTypeOf(a).toEqualTypeOf<
          RunArgs<{ id: string; note?: string | undefined; cancelled?: boolean | undefined }, Deps>
        >()
        return a.context.id
      },
    })
    // @ts-expect-error the key function must return a string
    s.task(async () => 1, { idempotent: () => 42 })
    // @ts-expect-error `idempotent` is a task option
    s.view({ idempotent: true })
  })
  it('ErrorOf is the mapError value type (awaited); never without mapError; typed on StepState.error.data', () => {
    expectTypeOf<ErrorOf<F, 'post'>>().toEqualTypeOf<LedgerFailure>()
    expectTypeOf<ErrorOf<F, 'plain'>>().toEqualTypeOf<{ reason: string }>()
    expectTypeOf<ErrorOf<F, 'review'>>().toEqualTypeOf<never>()
    expectTypeOf<ErrorOf<F, 'done'>>().toEqualTypeOf<never>()
    expectTypeOf<StepState<F, 'post'>['error']>().toEqualTypeOf<
      StepErrorOf<F, 'post'> | undefined
    >()
    expectTypeOf<NonNullable<StepState<F, 'post'>['error']>['data']>().toEqualTypeOf<
      LedgerFailure | undefined
    >()
    expectTypeOf<NonNullable<StepState<F, 'review'>['error']>['data']>().toEqualTypeOf<undefined>()
    // The phantom sits in the compact FlowStep as a trailing parameter (defaults keep old shapes valid).
    expectTypeOf(flow.steps.post).toEqualTypeOf<
      FlowStep<never, { ref: string }, 'route', 'task', never, LedgerFailure>
    >()
    expectTypeOf(flow.steps.done).toEqualTypeOf<FlowStep<never, undefined, never, 'final', never>>()
    // Wizard state carries it too.
    expectTypeOf(wizard.getState().steps.post.error?.data).toEqualTypeOf<
      LedgerFailure | undefined
    >()
    // @ts-expect-error `mapError` is a task option
    s.wait({ on: { 'note.added': () => {} }, mapError: () => 1 })
  })
})
