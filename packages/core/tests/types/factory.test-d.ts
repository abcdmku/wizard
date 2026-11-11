import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  boundary,
  defineWizard,
  type OutputOf,
  type RequiredDepsOf,
  type Run,
  type StepId,
  type WizardOutput,
} from '../../src'

const wizard = defineWizard(
  {
    name: 'typed',
    context: z.object({ name: z.string() }),
    deps: boundary.trusted<{ load: (name: string) => Promise<number>; label: string }>(),
    events: { approved: z.object({ by: z.string() }) },
  },
  ({ step, view, steps }) =>
    steps({
      form: view({ input: z.object({ count: z.number() }), next: 'load' }),
      load: step({ run: ({ context, deps }) => deps.load(context.name), next: 'done' }),
      done: step({ run: ({ context }) => ({ name: context.name }) }),
    }),
)

expectTypeOf<StepId<typeof wizard>>().toEqualTypeOf<'form' | 'load' | 'done'>()
expectTypeOf<OutputOf<typeof wizard, 'load'>>().toEqualTypeOf<number>()
expectTypeOf<WizardOutput<typeof wizard>>().toEqualTypeOf<{ name: string }>()
// @ts-expect-error the wizard itself is the flow definition
wizard.flow

// @ts-expect-error services are required
wizard.create({ name: 'Ada' })
// @ts-expect-error incorrect service implementation
wizard.provide({ load: () => 'wrong' })
// @ts-expect-error unknown service
wizard.provide({ typo: true })
const partial = wizard.provide({ load: async () => 1 })
declare const uncertain: Partial<{ load: (name: string) => Promise<number>; label: string }>
const uncertainFactory = wizard.provide(uncertain)
// @ts-expect-error optional keys are not guaranteed to have been supplied
uncertainFactory.create({ name: 'Ada' })
// @ts-expect-error label remains required
partial.create({ name: 'Ada' })
const ready = partial.provide({ label: 'test' })
const run = ready.create({ name: 'Ada' })
expectTypeOf(run).toEqualTypeOf<Run<typeof ready>>()
expectTypeOf<RequiredDepsOf<typeof partial>>().toMatchTypeOf<{ label: string }>()
// @ts-expect-error input inferred from context boundary
ready.create({ name: 1 })
// @ts-expect-error literal view IDs only
run.go('load')
// @ts-expect-error draft inferred from view boundary
run.setInput('form', { count: 'wrong' })
run.send('approved', { by: 'Lin' }, { eventId: 'evt_1' })
// @ts-expect-error event payloads are checked against the schema input
run.send('approved', { by: 1 })
const result = ready.runSync({ name: 'Ada' })
if (result.status === 'done') expectTypeOf(result.output).toEqualTypeOf<{ name: string }>()

defineWizard({ name: 'invalid', context: z.object({}) }, ({ view, steps }) =>
  steps({
    // @ts-expect-error unknown graph reference
    form: view({ next: 'missing' }),
  }),
)

const declarative = defineWizard(
  { name: 'declarative', context: z.object({ count: z.number() }) },
  ({ step, steps }) =>
    steps({
      work: step({
        run: async ({ context }) => ({ count: context.count }),
        exit: ({ output }) => {
          expectTypeOf(output).toEqualTypeOf<{ count: number }>()
        },
        mapError: () => ({ code: 'offline' as const }),
        next: 'done',
      }),
      done: step({}),
    }),
)
expectTypeOf<OutputOf<typeof declarative, 'work'>>().toEqualTypeOf<{ count: number }>()

const asyncSink = defineWizard({ name: 'async-sink', context: z.object({}) }, ({ step, steps }) =>
  steps({
    done: step({ run: async () => ({ answer: 42 }) }),
  }),
)
expectTypeOf<WizardOutput<typeof asyncSink>>().toEqualTypeOf<{ answer: number }>()

const parsed = defineWizard({ name: 'parsed', context: z.object({}) }, ({ step, steps }) =>
  steps({
    work: step({
      run: () => '42',
      output: z.string().transform(Number),
      exit: ({ output }) => {
        expectTypeOf(output).toEqualTypeOf<number>()
      },
      next: 'done',
    }),
    done: step({}),
  }),
)
expectTypeOf<OutputOf<typeof parsed, 'work'>>().toEqualTypeOf<number>()
