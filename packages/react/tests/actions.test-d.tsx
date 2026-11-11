import { boundary, defineProjection, defineWizard, type Run } from '@openwizard/core'
import type { MirrorResult } from '@openwizard/core/mirror'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { bindReact, type RunActions, useRun } from '../src/index'

const checkout = defineWizard(
  {
    name: 'provided-checkout',
    context: z.object({ count: z.number() }),
    events: { token: z.string().transform((value) => ({ length: value.length })) },
    deps: boundary.trusted<{ reserve(count: number): string }>(),
  },
  ({ step, steps }) =>
    steps({ reserve: step({ run: ({ context, deps }) => deps.reserve(context.count) }) }),
).provide({ reserve: (count) => `reservation-${count}` })
const client = defineProjection(checkout, { expose: { steps: { reserve: { output: true } } } })

describe('current React action contracts', () => {
  it('binds a provided wizard and preserves its run type', () => {
    const binding = bindReact<typeof checkout>()
    const run = useRun(() => checkout.create({ count: 1 }))
    expectTypeOf(run).toEqualTypeOf<Run<typeof checkout>>()
    expectTypeOf(binding.useActions()).toEqualTypeOf<RunActions<typeof checkout>>()
    ;<binding.Provider source={run} />
    expectTypeOf(binding.useStep('reserve').output).toEqualTypeOf<string | undefined>()
  })

  it('accepts schema input payloads, event IDs, and typed retry patches', () => {
    const actions = bindReact<typeof checkout>().useActions()
    actions.send('token', 'raw-token', { eventId: 'delivery-1', correlationId: 'request-1' })
    actions.send('token', {} as unknown)
    // @ts-expect-error send parses the input, which is a string, rather than the handler output
    actions.send('token', { length: 9 })
    actions.retry('reserve', { patch: { count: 2 } })
    // @ts-expect-error retry patch must use a context field
    actions.retry('reserve', { patch: { total: 2 } })
    // @ts-expect-error retry patch preserves the context field type
    actions.retry('reserve', { patch: { count: 'two' } })
    actions.startStep('reserve')
    actions.startReady()
    // @ts-expect-error removed command alias
    actions.run('reserve')
    // @ts-expect-error removed command alias
    actions.runReady()
    // @ts-expect-error unknown runnable step
    actions.startStep('resreve')
  })

  it('keeps the same commands for a projected Mirror with MirrorResult results', () => {
    const actions = bindReact<typeof client>().useActions()
    expectTypeOf(actions.startStep('reserve')).toEqualTypeOf<Promise<MirrorResult>>()
    expectTypeOf(actions.startReady()).toEqualTypeOf<Promise<MirrorResult>>()
    expectTypeOf(actions.retry('reserve', { patch: { count: 2 } })).toEqualTypeOf<
      Promise<MirrorResult>
    >()
    expectTypeOf(actions.send('token', 'raw', { eventId: 'delivery-2' })).toEqualTypeOf<
      Promise<MirrorResult>
    >()
    // @ts-expect-error transformed output is not the schema input
    actions.send('token', { length: 3 })
  })
})
