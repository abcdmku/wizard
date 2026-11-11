import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { boundary, defineWizard } from '../../src'
import type {
  AnyFlow,
  ErrorOf,
  EventArgs,
  FlowOnArgs,
  HookArgs,
  OutputOf,
  RunArgs,
  StepId,
} from '../../src/authoring/types'
import type { Run, StepErrorOf, StepState } from '../../src/wizard/create-wizard'

interface Deps {
  ledger: { post(id: string): Promise<{ ref: string }> }
}
type Context = { id: string; note?: string | undefined; cancelled?: boolean | undefined }
type LedgerFailure = { code: 'LEDGER_DOWN' | 'REJECTED'; attempt: number }

export const wizard = defineWizard(
  {
    name: 'event-authoring',
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
    on: {
      'note.added': (args) => {
        expectTypeOf(args).toEqualTypeOf<
          FlowOnArgs<Context, Deps, { text: string }, 'note.added'>
        >()
        args.update({ note: args.payload.text })
      },
      'order.cancelled': ({ payload }) => ({ cancel: payload.reason }),
    },
    correlate: {
      'order.cancelled': (payload) => {
        expectTypeOf(payload).toEqualTypeOf<{ orderId: string; reason: string }>()
        return payload.orderId
      },
    },
  },
  ({ step, view, steps }) => {
    step({
      run: async () => 1,
      on: {
        // @ts-expect-error runnable step handlers cannot redirect
        'note.added': () => ({ next: 'done' }),
      },
    })
    step({
      next: null,
      on: {
        // @ts-expect-error routing step handlers cannot redirect
        'note.added': () => ({ next: 'done' }),
      },
    })
    step({ run: async () => 1, on: { 'note.added': async () => {} } })
    view({
      on: {
        // @ts-expect-error keep is a wait-only result
        'note.added': () => ({ keep: true }),
      },
    })
    step({
      on: {
        'order.cancelled': (args) => {
          expectTypeOf(args).toEqualTypeOf<
            EventArgs<Context, Deps, { orderId: string; reason: string }, 'order.cancelled'>
          >()
        },
        // @ts-expect-error only declared event names are accepted
        'nope.event': () => {},
      },
    })
    step({
      run: async () => 1,
      idempotencyKey: (args) => {
        expectTypeOf(args).toEqualTypeOf<RunArgs<Context, Deps>>()
        return args.context.id
      },
    })
    step({
      run: () => 1,
      // @ts-expect-error the idempotency key must be a string
      idempotencyKey: () => 42,
    })
    view({
      // @ts-expect-error idempotent applies only to runnable steps
      idempotencyKey: true,
    })
    step({
      run: () => 1,
      // @ts-expect-error when returns a boolean or a promise of one
      when: () => 'yes',
    })
    return steps(
      {
        review: view({
          input: z.object({ ok: z.boolean() }),
          on: {
            'note.added': ({ payload, update }) => {
              update({ note: payload.text })
              return { next: 'post' }
            },
          },
          when: (args) => {
            expectTypeOf(args).toEqualTypeOf<HookArgs<Context, Deps>>()
            return args.context.note !== 'skip-review'
          },
          next: 'post',
        }),
        post: step({
          run: ({ deps, context }) => deps.ledger.post(context.id),
          on: { 'note.added': ({ payload, update }) => update({ note: payload.text }) },
          idempotencyKey: ({ context, attempt }) => `${context.id}#${attempt}`,
          mapError: (error, args): LedgerFailure => {
            expectTypeOf(error).toEqualTypeOf<unknown>()
            expectTypeOf(args).toEqualTypeOf<RunArgs<Context, Deps>>()
            return {
              code: error instanceof Error ? 'LEDGER_DOWN' : 'REJECTED',
              attempt: args.attempt,
            }
          },
          when: ({ context }) => context.cancelled !== true,
          next: 'route',
        }),
        plain: step({
          run: async () => 1,
          mapError: async () => ({ reason: 'x' }),
          idempotencyKey: true,
          next: 'route',
        }),
        route: step({ next: 'done', when: () => true, on: { 'note.added': () => {} } }),
        hold: step({
          waitFor: {
            'note.added': ({ payload }) =>
              payload.text === 'wait' ? { keep: true } : { done: payload.text },
          },
          when: () => true,
          next: 'done',
        }),
        done: step({ on: { 'note.added': () => {} } }),
      },
      { start: 'review' },
    )
  },
)
type F = typeof wizard
declare const run: Run<F>

describe('step event handler contracts', () => {
  it('preserves wait output and reports bad view handler references on their step', () => {
    expectTypeOf<OutputOf<F, 'hold'>>().toEqualTypeOf<string>()
    const bad = defineWizard(
      { name: 'bad-view-handler', context: z.object({}), events: { ping: z.boolean() } },
      ({ view, step, steps }) =>
        steps({
          // @ts-expect-error a handler target must belong to this wizard
          v: view({ on: { ping: () => ({ next: 'typo' }) } }),
          end: step({}),
        }),
    )
    expectTypeOf<StepId<typeof bad>>().toEqualTypeOf<'v' | 'end'>()
  })
})

describe('flow-level handlers and correlation', () => {
  it('rejects redirects and preserves every declared event', () => {
    defineWizard(
      {
        name: 'bad-on',
        context: z.object({}),
        events: { ping: z.boolean() },
        on: {
          // @ts-expect-error a flow-level handler cannot redirect
          ping: () => ({ next: 'x' }),
        },
      },
      ({ step, steps }) => steps({ done: step({}) }),
    )
    const partial = defineWizard(
      {
        name: 'partial-events',
        context: boundary.trusted<{ a: string }>(),
        events: { ping: z.number(), pong: z.string() },
        on: {
          ping: (args) => {
            // @ts-expect-error a flow-level handler belongs to no step
            args.step
          },
          // @ts-expect-error flow handlers must name declared events
          absent: () => {},
        },
        correlate: { pong: (payload) => payload },
      },
      ({ step, steps }) => steps({ wait: step({ waitFor: { pong: () => {} } }) }),
    )
    expectTypeOf<keyof NonNullable<(typeof partial)['~types']>['events']>().toEqualTypeOf<
      'ping' | 'pong'
    >()
  })
  it('correlation extractors return string or undefined', () => {
    defineWizard(
      {
        name: 'bad-correlate',
        context: z.object({}),
        events: { ping: z.number() },
        correlate: {
          // @ts-expect-error correlation ids must be strings
          ping: (payload) => payload,
        },
      },
      ({ step, steps }) => steps({ done: step({}) }),
    )
    defineWizard(
      {
        name: 'bad-correlate-event',
        context: z.object({}),
        events: { ping: z.string() },
        correlate: {
          // @ts-expect-error extractors must name declared events
          pong: () => 'x',
        },
      },
      ({ step, steps }) => steps({ done: step({}) }),
    )
    expectTypeOf(wizard).toMatchTypeOf<AnyFlow>()
  })
})

describe('mapped errors', () => {
  it('stores the awaited mapError value in ErrorOf and step state', () => {
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
    expectTypeOf(run.getState().steps.post.error?.data).toEqualTypeOf<LedgerFailure | undefined>()
  })
})
