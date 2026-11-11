/**
 * Type tests — deny-by-default projections (ADR-001 case 12) and nesting depth (R5).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { Issue, Progress, SerializedError, WizardOutput } from '../../src/authoring/types'
import { createMirror } from '../../src/mirror/create-mirror'
import { createMirrorSource, type MirrorSource } from '../../src/mirror/source'
import type { Transport } from '../../src/mirror/transport'
import {
  type AnyProjection,
  type ChildSummary,
  type ClientStepError,
  defineProjection,
  type Projection,
  type ProjectionOutput,
} from '../../src/projection/define-projection'
import type { Run, Snapshot } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const fulfilmentFlow = defineWizard(
  {
    name: 'fulfilment',
    context: z.object({ orderId: z.string(), trackingId: z.string().optional() }),
  },
  ({ step, steps }) =>
    steps({
      label: step({
        run: async () => ({ trackingId: 'x' }),
        exit: ({ output, update }) => update({ trackingId: output.trackingId }),
        next: 'done',
      }),
      done: step({ run: ({ context }) => ({ trackingId: context.trackingId }) }),
    }),
)
const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    context: z.object({
      cartId: z.string(),
      total: z.number(),
      express: z.boolean().default(false),
      secret: z.string(),
    }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  },
  ({ step, view, child, steps }) =>
    steps(
      {
        shipping: view({
          input: z.object({ address: z.string(), express: z.boolean().default(false) }),
          next: 'reserve',
        }),
        reserve: step({
          run: async () => ({ reservationId: 'r' }),
          next: 'fulfil',
        }),
        fulfil: child(fulfilmentFlow, {
          context: ({ context }) => ({ orderId: context.cartId }),
          next: 'receipt',
        }),
        receipt: step({ next: null }),
      },
      { start: 'shipping' },
    ),
)
export const checkoutClient = defineProjection(checkoutFlow, {
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
    expectTypeOf<ClientCheckout['context']>().toEqualTypeOf<{
      total: number
      express: boolean
    }>()
    expectTypeOf<keyof ClientCheckout['steps']['shipping']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt' | 'issues' | 'input'
    >()
    expectTypeOf<ClientCheckout['steps']['shipping']['input']>().toEqualTypeOf<
      | {
          address?: string
          express?: boolean | undefined
        }
      | undefined
    >()
    expectTypeOf<ClientCheckout['steps']['shipping']['issues']>().toEqualTypeOf<
      readonly Issue[] | undefined
    >()
    expectTypeOf<keyof ClientCheckout['steps']['fulfil']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt' | 'output' | 'child'
    >()
    expectTypeOf<ClientCheckout['steps']['fulfil']['output']>().toEqualTypeOf<
      | {
          trackingId: string | undefined
        }
      | undefined
    >()
    // `child: true` = the compact summary, not the nested projected state
    expectTypeOf<ClientCheckout['steps']['fulfil']['child']>().toEqualTypeOf<
      ChildSummary | undefined
    >()
    expectTypeOf<keyof ClientCheckout['steps']['reserve']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt' | 'error'
    >()
    // `reserve` has no `mapError`: its projected error is a bare `SerializedError` (`data?: never`).
    expectTypeOf<ClientCheckout['steps']['reserve']['error']>().toEqualTypeOf<
      ClientStepError<never> | undefined
    >()
    expectTypeOf<ClientStepError<never>>().toMatchTypeOf<SerializedError>()
    expectTypeOf<ClientCheckout['steps']['reserve']['id']>().toEqualTypeOf<'reserve'>()
    expectTypeOf<ClientCheckout['steps']['reserve']['kind']>().toEqualTypeOf<'step'>()
    expectTypeOf<keyof ClientCheckout['steps']['receipt']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt'
    >()
    expectTypeOf<ClientCheckout['current']>().toEqualTypeOf<'shipping' | null>()
    expectTypeOf<ClientCheckout['output']>().toEqualTypeOf<
      WizardOutput<typeof checkoutFlow> | undefined
    >()
    expectTypeOf<ClientCheckout['seq']>().toEqualTypeOf<number>()
    expectTypeOf<ClientCheckout['instanceId']>().toEqualTypeOf<string>()
  })
  it('a projection with no exposure exposes nothing but the base facts: no flow output, issues, errors or children', () => {
    const bare = defineProjection(checkoutFlow, { expose: {} })
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
    const twin = defineWizard(
      {
        name: 'checkout',
        context: z.object({
          cartId: z.string(),
          total: z.number(),
          express: z.boolean().default(false),
          secret: z.string(),
        }),
        events: { 'payment.captured': z.object({ paymentId: z.string() }) },
      },
      ({ step, view, child, steps }) =>
        steps(
          {
            shipping: view({
              input: z.object({ address: z.string(), express: z.boolean().default(false) }),
              next: 'reserve',
            }),
            reserve: step({
              run: async () => ({ reservationId: 'r' }),
              next: 'fulfil',
            }),
            fulfil: child(fulfilmentFlow, {
              context: ({ context }) => ({ orderId: context.cartId }),
              next: 'receipt',
            }),
            receipt: step({ next: null }),
          },
          { start: 'shipping' },
        ),
    )
    const twinProjection = defineProjection(twin, { expose: {} })
    const run = {} as Run<typeof checkoutFlow>
    // Compiles (structural types) — `run.project` throws DEFINITION_INVALID at runtime.
    run.project(twinProjection)
    expectTypeOf(twinProjection.wizard).toEqualTypeOf<typeof twin>()
  })
})
const mappedFlow = defineWizard(
  { name: 'mapped', context: z.object({ id: z.string() }) },
  ({ step, steps }) =>
    steps({
      post: step({
        run: async () => ({ ref: 'r' }),
        mapError: (error) => ({ code: error instanceof Error ? 'DOWN' : 'OTHER' }) as const,
        next: 'done',
      }),
      done: step({ next: null }),
    }),
)
describe('projections: progress, error data, select', () => {
  it('`progress: true` adds a required `progress: Progress`; absent otherwise', () => {
    const withProgress = defineProjection(checkoutFlow, { expose: { progress: true } })
    expectTypeOf<ProjectionOutput<typeof withProgress>['progress']>().toEqualTypeOf<Progress>()
    expectTypeOf<keyof ProjectionOutput<typeof withProgress>>().toEqualTypeOf<
      'instanceId' | 'epoch' | 'seq' | 'status' | 'current' | 'context' | 'steps' | 'progress'
    >()
    // @ts-expect-error `progress` is a boolean
    defineProjection(checkoutFlow, { expose: { progress: 'yes' } })
  })
  it('`error: true` exposes `{ name, message, code?, data?: ErrorOf }`', () => {
    const p = defineProjection(mappedFlow, { expose: { steps: { post: { error: true } } } })
    expectTypeOf<ProjectionOutput<typeof p>['steps']['post']['error']>().toEqualTypeOf<
      | ClientStepError<{
          readonly code: 'DOWN' | 'OTHER'
        }>
      | undefined
    >()
    expectTypeOf<
      NonNullable<ProjectionOutput<typeof p>['steps']['post']['error']>['data']
    >().toEqualTypeOf<
      | {
          readonly code: 'DOWN' | 'OTHER'
        }
      | undefined
    >()
  })
  it('`select` projections are Projection<F, T> with T = the mapper return; state is the typed run state', () => {
    const summary = defineProjection(checkoutFlow, {
      select: (state) => {
        expectTypeOf(state).toEqualTypeOf<Snapshot<typeof checkoutFlow>['state']>()
        expectTypeOf(state.steps.reserve.output).toEqualTypeOf<
          | {
              reservationId: string
            }
          | undefined
        >()
        return { at: state.current, total: state.context.total, done: state.status === 'done' }
      },
    })
    expectTypeOf(summary).toEqualTypeOf<
      Projection<
        typeof checkoutFlow,
        {
          at: 'shipping' | null
          total: number
          done: boolean
        }
      >
    >()
    expectTypeOf<ProjectionOutput<typeof summary>>().toEqualTypeOf<{
      at: 'shipping' | null
      total: number
      done: boolean
    }>()
    expectTypeOf(summary.wizard).toEqualTypeOf<typeof checkoutFlow>()
    expectTypeOf(summary).toMatchTypeOf<AnyProjection>()
    // The Run / MirrorSource / Mirror carry T.
    const run = {} as Run<typeof checkoutFlow>
    expectTypeOf(run.project(summary)).toEqualTypeOf<{
      at: 'shipping' | null
      total: number
      done: boolean
    }>()
    expectTypeOf(run.project(checkoutClient)).toEqualTypeOf<ClientCheckout>()
    expectTypeOf(createMirrorSource(run, summary)).toEqualTypeOf<
      MirrorSource<{
        at: 'shipping' | null
        total: number
        done: boolean
      }>
    >()
    const transport = {} as Transport<{
      at: 'shipping' | null
      total: number
      done: boolean
    }>
    const mirror = createMirror<typeof summary>({ transport })
    expectTypeOf(mirror.getSnapshot()).toEqualTypeOf<{
      at: 'shipping' | null
      total: number
      done: boolean
    } | null>()
    // The mirror sugar is still typed by the projection's flow.
    mirror.go('shipping')
    // @ts-expect-error not a view of the flow
    mirror.go('reserve')
  })
  it('`expose` and `select` are mutually exclusive', () => {
    // @ts-expect-error give one of `expose` / `select`, not both
    defineProjection(checkoutFlow, { expose: {}, select: () => 1 })
    // @ts-expect-error give one of `expose` / `select`
    defineProjection(checkoutFlow, {})
  })
})
export const badExpose = defineProjection(checkoutFlow, {
  // @ts-expect-error unknown step id in `expose.steps`
  expose: { steps: { typo: { input: true } } },
})
export const badExposeCtx = defineProjection(checkoutFlow, {
  // @ts-expect-error unknown context key
  expose: { context: ['nope'] },
})
export const badExposeChild = defineProjection(checkoutFlow, {
  // @ts-expect-error `child` exposure is only valid on flow steps
  expose: { steps: { reserve: { child: {} } } },
})
export const badExposeOutput = defineProjection(checkoutFlow, {
  // @ts-expect-error `output` is a boolean
  expose: { output: 'yes' },
})
export const okExposeChild = defineProjection(checkoutFlow, {
  expose: {
    steps: {
      fulfil: { output: true, child: { steps: { label: { output: true } }, context: ['orderId'] } },
    },
  },
})
describe('nested exposure', () => {
  it('types the child ClientState from the child flow (deny-by-default inside too)', () => {
    type Child = NonNullable<ProjectionOutput<typeof okExposeChild>['steps']['fulfil']['child']>
    expectTypeOf<Child['context']>().toEqualTypeOf<{
      orderId: string
    }>()
    expectTypeOf<Child['steps']['label']['output']>().toEqualTypeOf<
      | {
          trackingId: string
        }
      | undefined
    >()
    expectTypeOf<keyof Child['steps']['done']>().toEqualTypeOf<
      'id' | 'kind' | 'status' | 'phase' | 'attempt'
    >()
    expectTypeOf<keyof Child>().toEqualTypeOf<
      'instanceId' | 'epoch' | 'seq' | 'status' | 'current' | 'context' | 'steps'
    >()
  })
})
