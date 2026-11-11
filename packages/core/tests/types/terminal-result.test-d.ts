import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type {
  Run,
  RunHalted,
  RunLifecycleError,
  RunOutcome,
  RunResult,
  TerminalFailure,
  WaitingFor,
} from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const childWizard = defineWizard(
  { name: 'result-child', context: z.object({ id: z.string() }) },
  ({ step, steps }) => steps({ done: step({ run: ({ context }) => context.id }) }),
)

type Down = { readonly code: 'DOWN' }

const root = defineWizard(
  { name: 'result-root', context: z.object({ id: z.string() }) },
  ({ step, child, steps }) =>
    steps({
      work: step({ run: () => 1, mapError: (): Down => ({ code: 'DOWN' }), next: 'child' }),
      child: child(childWizard, { context: ({ context }) => ({ id: context.id }), next: 'end' }),
      end: step({ run: () => ({ ok: true as const }) }),
    }),
)

declare const run: Run<typeof root>

describe('Run terminal result types', () => {
  it('carries the flow output and typed failure channel', () => {
    expectTypeOf(run.result()).toEqualTypeOf<RunResult<typeof root> | undefined>()
    expectTypeOf(run.awaitResult()).toEqualTypeOf<Promise<RunResult<typeof root>>>()
    expectTypeOf(run.subscribeResult)
      .parameter(0)
      .toEqualTypeOf<(result: RunResult<typeof root>) => void>()
    expectTypeOf<RunLifecycleError['code']>().toEqualTypeOf<'RUN_RESET' | 'RUN_DISPOSED'>()

    run.subscribeResult((result) => {
      if (result.status === 'done') {
        expectTypeOf(result.output).toEqualTypeOf<{ ok: true }>()
      } else if (result.status === 'failed') {
        expectTypeOf(result.failure).toEqualTypeOf<
          Exclude<TerminalFailure<typeof root>, { kind: 'cancelled' }>
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

  it('keeps child Run result typing recursive', () => {
    const childRun = run.child('child')
    expectTypeOf(childRun.result()).toEqualTypeOf<RunResult<typeof childWizard> | undefined>()
    expectTypeOf(childRun.awaitResult()).toEqualTypeOf<Promise<RunResult<typeof childWizard>>>()
  })
})

describe('Run outcome types', () => {
  it('awaitOutcome narrows to a result, a halt or a flat waitingFor list', async () => {
    expectTypeOf(run.awaitOutcome()).toEqualTypeOf<Promise<RunOutcome<typeof root>>>()
    expectTypeOf(run.waitingFor()).toEqualTypeOf<readonly WaitingFor<typeof root>[]>()
    expectTypeOf(run.explain('work').waitingFor).toEqualTypeOf<readonly WaitingFor<typeof root>[]>()
    const outcome = await run.awaitOutcome()
    if (outcome.status === 'halted') {
      if (outcome.failure.step === 'child') {
        expectTypeOf(outcome.failure.child).toEqualTypeOf<
          RunResult<typeof childWizard> | RunHalted<typeof childWizard> | undefined
        >()
      }
    } else if (outcome.status === 'waiting') {
      const [first] = outcome.waitingFor
      if (first !== undefined && first.kind !== 'view')
        expectTypeOf(first.deadline).toEqualTypeOf<number | undefined>()
    }
  })
})
