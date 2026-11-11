import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { createRunFailure, RUN_ADAPTER, type RunAdapter } from '../../src/authoring/run-adapter'
import type {
  AnyFlow,
  AnyWizard,
  EventType,
  IsEach,
  JsonValue,
  OutputOf,
  PayloadInput,
  PayloadOf,
  RequiredDepsOf,
  RetryStepId,
  RunStepId,
  StepApi,
  ViewId,
} from '../../src/authoring/types'
import { defineWizard } from '../../src/wizard/define-wizard'

const transformed = defineWizard(
  {
    name: 'transformed-event',
    context: z.object({}),
    events: { count: z.string().transform((value) => value.length) },
  },
  ({ step, steps }) =>
    steps({ wait: step({ waitFor: { count: ({ payload }) => ({ done: payload + 1 }) } }) }),
)
expectTypeOf<PayloadInput<typeof transformed, 'count'>>().toEqualTypeOf<string>()
expectTypeOf<PayloadOf<typeof transformed, 'count'>>().toEqualTypeOf<number>()
expectTypeOf<OutputOf<typeof transformed, 'wait'>>().toEqualTypeOf<number>()
const transformedRun = transformed.create({})
transformedRun.send('count', 'three')
declare const requestBody: unknown
transformedRun.send('count', requestBody)
// @ts-expect-error send accepts the boundary input, not its parsed output
transformedRun.send('count', 3)
// @ts-expect-error event names come from the definition
transformedRun.send('missing', 'three')

const ownHandlers = defineWizard(
  {
    name: 'reserved-event-names',
    context: z.object({}),
    events: { toString: boundary.trusted<{}>(), event: boundary.trusted<{ id: string }>() },
  },
  ({ step, steps }) =>
    steps({ wait: step({ waitFor: { event: ({ payload }) => ({ done: payload.id }) } }) }),
)
expectTypeOf<OutputOf<typeof ownHandlers, 'wait'>>().toEqualTypeOf<string>()

const timeoutNeeds = defineWizard(
  {
    name: 'timeout-output',
    context: z.object({}),
    events: { received: z.object({ id: z.string() }) },
  },
  ({ step, steps }) => {
    const wait = step({
      waitFor: { received: ({ payload }) => ({ done: payload }) },
      timeout: { after: 10, next: 'expired' },
    })
    return steps({
      wait,
      join: step({
        needs: { wait },
        run: ({ needs }) => {
          expectTypeOf(needs.wait).toEqualTypeOf<{ id: string } | undefined>()
          // @ts-expect-error the wait can complete with no value when its deadline expires
          needs.wait.id.toUpperCase()
          return needs.wait?.id ?? 'expired'
        },
      }),
      expired: step({ run: () => 'expired' }),
    })
  },
)
expectTypeOf<OutputOf<typeof timeoutNeeds, 'wait'>>().toEqualTypeOf<{ id: string } | undefined>()

declare const maybeRun: { run?: () => number }
declare const maybeOutput: { run: () => string; output?: ReturnType<typeof z.number> }
declare const maybeInput: { input?: ReturnType<typeof z.number> }
const sharedLabel: { label?: string } = {}
defineWizard({ name: 'present-behavior', context: z.object({}) }, ({ step, view, steps }) =>
  steps({
    // @ts-expect-error an optional run cannot promise a runnable step with numeric output
    optionalRun: step(maybeRun),
    // @ts-expect-error an optional boundary cannot guarantee the parsed numeric output
    optionalOutput: step(maybeOutput),
    // @ts-expect-error an optional view boundary cannot guarantee a parsed value
    optionalInput: view(maybeInput),
    shared: step({ ...sharedLabel, run: () => 1 }),
  }),
)

defineWizard({ name: 'routing-declarations', context: z.object({}) }, ({ step, steps }) =>
  steps({
    // @ts-expect-error targets describe a routing function
    staticTargets: step({ next: 'end', targets: ['end'] }),
    // @ts-expect-error declaring targets also requires a routing function
    noRoute: step({ targets: ['end'] }),
    // @ts-expect-error even a routing function returning only null declares its targets
    noTargets: step({ next: () => null }),
    stop: step({ targets: ['end'], next: () => null }),
    end: step({ run: () => 1 }),
  }),
)

defineWizard(
  { name: 'closed-wait-results', context: z.object({}), events: { ready: z.string() } },
  ({ step, steps }) =>
    steps({
      keep: step({
        // @ts-expect-error wait handlers cannot route while continuing to wait
        waitFor: { ready: () => ({ keep: true as const, next: 'end' }) },
      }),
      fail: step({
        // @ts-expect-error wait handlers cannot route when failing
        waitFor: { ready: () => ({ fail: 'down', next: 'end' }) },
      }),
      end: step({ run: () => 0 }),
    }),
)

declare const optionalDepsApi: StepApi<{}, {}, { token?: string }>
const optionalDepsStep = optionalDepsApi.step({ run: ({ deps }) => deps.token })
defineWizard(
  {
    name: 'bound-deps',
    context: boundary.trusted<{}>(),
    deps: boundary.trusted<{ token: string }>(),
  },
  ({ steps }) =>
    steps({
      // @ts-expect-error reusable modules must stay generic in the complete dependency type
      imported: optionalDepsStep,
    }),
)
declare const fewerEventsApi: StepApi<{}, { ready: string }, unknown>
const fewerEventsStep = fewerEventsApi.step({ run: () => 0 })
defineWizard(
  {
    name: 'bound-events',
    context: boundary.trusted<{}>(),
    events: { ready: z.string(), extra: z.number() },
  },
  ({ steps }) =>
    steps({
      // @ts-expect-error a imported module must use this wizard's event map
      imported: fewerEventsStep,
    }),
)

const allHookNeeds = defineWizard(
  { name: 'every-hook-needs', context: z.object({ total: z.number() }) },
  ({ step, steps }) => {
    const load = step({ run: () => ({ amount: 7 }) })
    const collect = step({
      needs: { load },
      when: ({ needs }) => needs.load.amount > 0,
      enter: ({ needs }) => expectTypeOf(needs.load.amount).toEqualTypeOf<number>(),
      run: ({ needs }) => needs.load.amount,
      idempotencyKey: ({ needs }) => `collect:${needs.load.amount}`,
      mapError: (_, { needs }) => ({ amount: needs.load.amount }),
      retry: { retries: 1, when: (error) => error.amount > 0 },
      compensate: ({ needs, idempotencyKey }) => {
        expectTypeOf(needs.load.amount).toEqualTypeOf<number>()
        expectTypeOf(idempotencyKey).toEqualTypeOf<string>()
      },
      exit: ({ needs, output }) => {
        expectTypeOf(needs.load.amount).toEqualTypeOf<number>()
        expectTypeOf(output).toEqualTypeOf<number>()
      },
    })
    return steps({ load, collect })
  },
)
expectTypeOf<OutputOf<typeof allHookNeeds, 'collect'>>().toEqualTypeOf<number>()

type Services = { token: string; log: (message: string) => void }
const serviced = defineWizard(
  { name: 'services', context: z.object({}), deps: boundary.trusted<Services>() },
  ({ step, steps }) => steps({ work: step({ run: ({ deps }) => deps.token }) }),
)
const partly = serviced.provide({ token: 'fixed' })
expectTypeOf<RequiredDepsOf<typeof partly>>().toEqualTypeOf<{ log: Services['log'] }>()
partly.create({}, { deps: { log: () => {} } })
// @ts-expect-error the remaining dependency is required
partly.create({})
// @ts-expect-error providing one key does not make another key optional
partly.create({}, { deps: {} })
declare const maybeToken: { token?: string }
const maybeProvided = serviced.provide(maybeToken)
expectTypeOf<RequiredDepsOf<typeof maybeProvided>>().toEqualTypeOf<Services>()

const optionalServices = defineWizard(
  {
    name: 'optional-services',
    context: z.object({}),
    deps: boundary.trusted<{ log?: (message: string) => void }>(),
  },
  ({ step, steps }) => steps({ work: step({ run: ({ deps }) => deps.log?.('ready') }) }),
)
optionalServices.create({})
optionalServices.runSync({})
const optionalChild = defineWizard(
  { name: 'optional-service-child', context: z.object({}) },
  ({ flow, steps }) => steps({ child: flow(optionalServices, { context: () => ({}) }) }),
)
optionalChild.create({})

declare const adapter: RunAdapter<{}, unknown, number, { readonly code: 'DOWN' }>
expectTypeOf(adapter[RUN_ADAPTER].run).parameter(0).toHaveProperty('idempotencyKey')
// @ts-expect-error an adapter is a record, not a callable function
adapter({})
// @ts-expect-error adapter error data must survive JSON persistence
type InvalidAdapter = RunAdapter<{}, unknown, number, Date>

export type { InvalidAdapter }

createRunFailure('typed', new Error('down'), { code: 'DOWN' } satisfies JsonValue)
// @ts-expect-error persisted adapter data cannot contain Date objects
createRunFailure('typed', new Error('down'), new Date())

// Erased readers retain broad ids, while concrete definitions keep literal ids.
expectTypeOf<EventType<AnyFlow>>().toEqualTypeOf<string>()
expectTypeOf<ViewId<AnyFlow>>().toEqualTypeOf<string>()
declare function acceptsHost<F extends AnyWizard>(wizard: F): F
acceptsHost(transformed)
acceptsHost(partly)
// @ts-expect-error the wizard itself is the flow; there is no compatibility property
transformed.flow

const leaf = defineWizard(
  { name: 'mapped-leaf', context: z.object({ value: z.number() }) },
  ({ step, steps }) => steps({ output: step({ run: ({ context }) => context.value }) }),
)
const mappedChildren = defineWizard(
  { name: 'mapped-children', context: z.object({ values: z.array(z.number()) }) },
  ({ flow, steps }) =>
    steps({
      one: flow(leaf, { context: () => ({ value: 1 }) }),
      many: flow(leaf, {
        each: ({ context }) => context.values,
        key: (_, index) => `item-${index}`,
        context: ({ item }) => ({ value: item }),
      }),
    }),
)
expectTypeOf<OutputOf<typeof mappedChildren, 'many'>>().toEqualTypeOf<number[]>()
expectTypeOf<IsEach<typeof mappedChildren, 'many'>>().toEqualTypeOf<true>()
expectTypeOf<IsEach<typeof mappedChildren, 'one'>>().toEqualTypeOf<false>()
expectTypeOf<RunStepId<typeof mappedChildren>>().toEqualTypeOf<never>()
expectTypeOf<RetryStepId<typeof mappedChildren>>().toEqualTypeOf<'many'>()
const mappedRun = mappedChildren.create({ values: [1, 2] })
mappedRun.child('one')
mappedRun.child('many', 0)
mappedRun.child('many', 'item-1')
mappedRun.retry('many')
// @ts-expect-error mapped child access requires an item selector
mappedRun.child('many')
// @ts-expect-error ordinary children do not accept an item selector
mappedRun.child('one', 0)
// @ts-expect-error child flows are not plain runnable hooks
mappedRun.startStep('many')
