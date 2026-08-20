import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineFlow } from '../../src/authoring/define-flow'
import type {
  FlowFailure,
  FlowRun,
  RunLifecycleError,
  RunResult,
} from '../../src/wizard/create-wizard'

const childBuilder = defineFlow({ name: 'result-child', context: z.object({ id: z.string() }) })
const child = childBuilder.steps({
  done: childBuilder.final({ output: ({ context }) => context.id }),
})

interface Down {
  readonly code: 'DOWN'
}

const builder = defineFlow({ name: 'result-root', context: z.object({ id: z.string() }) })
const root = builder.steps({
  work: builder.task(() => 1, {
    mapError: (): Down => ({ code: 'DOWN' }),
    next: 'child',
  }),
  child: builder.flow(child, { context: ({ context }) => ({ id: context.id }), next: 'end' }),
  end: builder.final({ output: () => ({ ok: true as const }) }),
})

declare const run: FlowRun<typeof root>

describe('FlowRun terminal result types', () => {
  it('carries the flow output and typed failure channel', () => {
    expectTypeOf(run.result()).toEqualTypeOf<RunResult<typeof root> | undefined>()
    expectTypeOf(run.awaitResult()).toEqualTypeOf<Promise<RunResult<typeof root>>>()
    expectTypeOf(run.subscribeResult)
      .parameter(0)
      .toEqualTypeOf<(result: RunResult<typeof root>) => void>()
    expectTypeOf<RunLifecycleError['code']>().toEqualTypeOf<'RUN_RESET' | 'RUN_DISPOSED'>()

    run.subscribeResult((result) => {
      if (result.status === 'done') {
        expectTypeOf(result.output).toMatchTypeOf<{ readonly ok: boolean } | undefined>()
      } else if (result.status === 'failed') {
        expectTypeOf(result.failure).toEqualTypeOf<
          Exclude<FlowFailure<typeof root>, { kind: 'cancelled' }>
        >()
        if (result.failure.kind === 'step' && result.failure.step === 'work') {
          expectTypeOf(result.failure.error.data).toEqualTypeOf<
            { readonly code: 'DOWN' } | undefined
          >()
        }
      } else {
        expectTypeOf(result.failure.kind).toEqualTypeOf<'cancelled'>()
      }
    })
  })

  it('keeps child FlowRun result typing recursive', () => {
    const childRun = run.child('child')
    expectTypeOf(childRun.result()).toEqualTypeOf<RunResult<typeof child> | undefined>()
    expectTypeOf(childRun.awaitResult()).toEqualTypeOf<Promise<RunResult<typeof child>>>()
  })
})
