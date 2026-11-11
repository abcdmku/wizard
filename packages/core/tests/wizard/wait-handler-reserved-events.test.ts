import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('reserved event names', () => {
  it('does not inherit an omitted toString handler', async () => {
    const wizard = defineWizard(
      {
        name: 'omitted-to-string',
        context: boundary.trusted<{}>(),
        events: {
          toString: boundary.trusted<{}>(),
          event: boundary.trusted<{}>(),
        },
      },
      ({ step, steps }) =>
        steps({
          waiting: step({
            waitFor: {
              event: () => ({ keep: true as const }),
            },
          }),
        }),
    )
    const run = wizard.create({})
    await run.start()

    expect(await run.send('toString', {})).toMatchObject({ delivered: [], buffered: true })
    expect(run.getState().steps.waiting?.status).toBe('active')
  })

  it('runs a configured toString handler', async () => {
    const wizard = defineWizard(
      {
        name: 'configured-to-string',
        context: boundary.trusted<{ readonly seen?: string }>(),
        events: { toString: boundary.trusted<{ readonly value: string }>() },
      },
      ({ step, steps }) =>
        steps({
          waiting: step({
            waitFor: {
              toString: ({ payload, update }) => {
                update({ seen: payload.value })
                return { keep: true }
              },
            },
          }),
        }),
    )
    const run = wizard.create({})
    await run.start()

    expect(await run.send('toString', { value: 'yes' })).toMatchObject({
      delivered: ['waiting'],
      buffered: false,
    })
    expect(run.getState().context).toEqual({ seen: 'yes' })
  })

  it('runs an __proto__ handler as an own property', async () => {
    let calls = 0
    const wizard = defineWizard(
      {
        name: 'effect-proto',
        context: boundary.trusted<{ readonly count: number }>(),
        events: { ['__proto__']: boundary.trusted<{}>() },
      },
      ({ step, steps }) =>
        steps({
          waiting: step({
            waitFor: {
              ['__proto__']: ({ update }) => {
                calls += 1
                update((current) => ({ count: current.count + 1 }))
                return { keep: true }
              },
            },
          }),
        }),
    )
    const run = wizard.create({ count: 0 })
    await run.start()
    expect(await run.send('__proto__', {})).toMatchObject({ delivered: ['waiting'] })
    await run.whenIdle()
    expect(calls).toBe(1)
    expect(run.getState().context).toEqual({ count: 1 })
    expect(run.getState().steps.waiting?.status).toBe('active')
  })
})
