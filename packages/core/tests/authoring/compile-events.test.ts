import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compile } from '../../src/authoring/compile'
import { defineWizard } from '../../src/wizard/define-wizard'
import { hookArgs, rawFlow, rawStep } from './helpers'

describe('event handler compilation', () => {
  it('preserves wait completion, keep and failure results for event delivery', async () => {
    const wizard = defineWizard(
      { name: 'wait-results', context: z.object({}), events: { note: z.string() } },
      ({ step, steps }) =>
        steps({
          wait: step({
            waitFor: {
              note: ({ payload }) =>
                payload === 'wait'
                  ? { keep: true }
                  : payload === 'bad'
                    ? { fail: 'bad note' }
                    : { done: payload.toUpperCase() },
            },
          }),
        }),
    )
    const handler = compile(wizard).steps.wait?.hooks.waitFor?.note
    expect(await handler?.(hookArgs({ payload: 'wait' }))).toEqual({ keep: true })
    expect(await handler?.(hookArgs({ payload: 'bad' }))).toEqual({ fail: 'bad note' })
    expect(await handler?.(hookArgs({ payload: 'hello' }))).toEqual({ done: 'HELLO' })
  })

  it('resolves step objects returned by passive view handlers', async () => {
    const wizard = defineWizard(
      { name: 'view-event', context: z.object({}), events: { go: z.string() } },
      ({ step, view, steps }) => {
        const end = step({ run: () => true })
        return steps({
          form: view({ input: z.string(), on: { go: () => ({ next: end }) } }),
          end,
        })
      },
    )
    expect(await compile(wizard).steps.form?.hooks.on?.go?.(hookArgs({ payload: 'go' }))).toEqual({
      next: 'end',
    })
  })

  it('runs flow-level updates and returns an explicit cancellation', async () => {
    const wizard = defineWizard(
      {
        name: 'global-events',
        context: z.object({ note: z.string() }),
        events: { note: z.string(), cancel: z.string() },
        on: {
          note: ({ update, payload }) => update({ note: payload }),
          cancel: ({ payload }) => ({ cancel: payload }),
        },
      },
      ({ step, steps }) => steps({ wait: step({ waitFor: { note: () => ({ keep: true }) } }) }),
    )
    const def = compile(wizard)
    const patches: unknown[] = []
    expect(
      await def.on?.note?.(
        hookArgs({
          payload: 'hello',
          update: (patch: unknown) => {
            patches.push(patch)
          },
        }),
      ),
    ).toBeUndefined()
    expect(patches).toEqual([{ note: 'hello' }])
    expect(await def.on?.cancel?.(hookArgs({ payload: 'changed mind' }))).toEqual({
      cancel: 'changed mind',
    })
  })

  it('rejects invalid flow-level handler results from JavaScript', async () => {
    const def = compile(
      rawFlow(
        { end: rawStep({ run: () => true }) },
        {
          events: { event: z.string() },
          on: { event: () => ({ next: 'end' }) },
        },
      ),
    )
    await expect(async () => def.on?.event?.(hookArgs())).rejects.toThrow(
      'a wizard-level on handler must return void or { cancel: reason }',
    )
  })

  it('extracts correlation ids and ignores non-string extractor results', () => {
    const wizard = defineWizard(
      {
        name: 'correlated',
        context: z.object({}),
        events: { note: z.object({ id: z.string() }) },
        correlate: { note: (payload) => payload.id },
      },
      ({ step, steps }) => steps({ wait: step({ waitFor: { note: () => ({ done: true }) } }) }),
    )
    const def = compile(wizard)
    expect(def.correlate?.note?.({ id: 'order-1' })).toBe('order-1')
    expect(def.correlate?.note?.({ id: 42 })).toBeUndefined()
  })
})
