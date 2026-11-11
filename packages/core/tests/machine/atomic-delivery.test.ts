/**
 * R6 atomic delivery through the public API: a `waitFor` handler that halts the run during one
 * `send` stops the rest of that delivery (later step listeners and the flow-level `on` handler).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src'

describe('atomic event delivery', () => {
  it('a waitFor handler that halts the run stops the later listeners and the flow-level handler', async () => {
    const calls: string[] = []
    const wizard = defineWizard(
      {
        name: 'atomic-delivery',
        context: z.object({ flowSaw: z.number() }),
        events: { abort: z.null() },
        on: {
          abort: ({ context, update }) => {
            calls.push('flow')
            update({ flowSaw: context.flowSaw + 1 })
          },
        },
      },
      ({ step, steps }) =>
        steps(
          {
            first: step({
              waitFor: {
                abort: () => {
                  calls.push('first')
                  throw new Error('bad handler')
                },
              },
            }),
            second: step({
              waitFor: {
                abort: () => {
                  calls.push('second')
                  return { keep: true }
                },
              },
            }),
          },
          { start: ['first', 'second'] },
        ),
    )
    const run = wizard.create({ flowSaw: 0 })
    await run.start()

    await run.send('abort', null)

    expect(calls).toEqual(['first'])
    expect(run.getState().status).toBe('halted')
    expect(run.getState().context).toEqual({ flowSaw: 0 })
    expect(run.getState().steps.second?.status).toBe('active')
  })
})
