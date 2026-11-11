import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineWizard, type FlowOutput, type OutputOf } from '../../src'

const wizard = defineWizard(
  { name: 'named', context: z.object({ count: z.number() }), events: { ready: z.boolean() } },
  (constructors) => {
    expectTypeOf<keyof typeof constructors>().toEqualTypeOf<'step' | 'view' | 'flow' | 'steps'>()
    const { step, view, steps } = constructors
    const work = step({ run: ({ context }) => context.count })
    const linked = step({ run: () => 1, targets: [work], next: () => work })
    const form = view({ targets: [linked], next: () => linked, needs: { work } })
    return steps({ form, linked, work })
  },
)
expectTypeOf<OutputOf<typeof wizard, 'work'>>().toEqualTypeOf<number>()

defineWizard({ name: 'invalid-ref', context: z.object({}) }, ({ step, steps }) =>
  steps({
    // @ts-expect-error references must identify a step in the assembled map
    choose: step({ next: 'absent' }),
  }),
)

const selected = defineWizard(
  {
    name: 'selected',
    context: z.object({ count: z.number() }),
    output: ({ context }) => ({ total: context.count }),
  },
  ({ step, steps }) => steps({ work: step({ run: () => 'intermediate' }) }),
)
expectTypeOf<FlowOutput<typeof selected>>().toEqualTypeOf<{ total: number }>()

defineWizard(
  {
    name: 'invalid-output',
    context: z.object({}),
    // @ts-expect-error output selectors are pure and synchronous
    output: async () => 1,
  },
  ({ step, steps }) => steps({ done: step({}) }),
)
