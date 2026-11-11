import { expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src'

it('refuses an event whose asynchronous boundary was overtaken by cancellation', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let delivered = 0
  const wizard = defineWizard(
    {
      name: 'versioned-event',
      context: z.object({}),
      events: {
        approved: z.string().transform(async (value) => {
          await gate
          return value
        }),
      },
    },
    ({ step, steps }) =>
      steps({
        approval: step({
          waitFor: {
            approved: ({ payload }) => {
              delivered++
              return { done: payload }
            },
          },
        }),
      }),
  )
  const run = wizard.create({})
  await run.start()
  const { epoch, seq } = run.getState()
  const pending = run.dispatch(
    { type: 'send', event: 'approved', payload: 'accepted' },
    { expectedVersion: { epoch, seq } },
  )
  await run.cancel('no longer needed')
  release()
  expect(await pending).toMatchObject({ ok: false, code: 'STALE' })
  expect(delivered).toBe(0)
  expect(run.log().some((event) => event.type === 'event.received')).toBe(false)
  run.dispose()
})

it('refuses stale validation without recording the invalid payload', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const wizard = defineWizard(
    {
      name: 'versioned-rejection',
      context: z.object({}),
      events: {
        approved: z.string().refine(async () => {
          await gate
          return false
        }),
      },
    },
    ({ view, steps }) =>
      steps({ form: view({ input: z.object({ name: z.string() }), initial: { name: '' } }) }),
  )
  const run = wizard.create({})
  await run.start()
  const { epoch, seq } = run.getState()
  const pending = run.dispatch(
    { type: 'send', event: 'approved', payload: 'invalid' },
    { expectedVersion: { epoch, seq } },
  )
  await run.setInput('form', { name: 'newer input' })
  release()
  expect(await pending).toMatchObject({ ok: false, code: 'STALE' })
  expect(run.getState().steps.form.input).toEqual({ name: 'newer input' })
  expect(run.log().some((event) => event.type === 'event.rejected')).toBe(false)
  run.dispose()
})
