import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { RUN_ADAPTER } from '../../src/authoring/run-adapter'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('returned adapter output persistence', () => {
  it('validates a Date through adapter metadata but requires a declared boundary to save it', async () => {
    let parsed = 0
    const wizard = defineWizard(
      { name: 'returned-date', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          stamp: step({
            run: () => ({
              [RUN_ADAPTER]: {
                run: () => new Date('2026-10-13T00:00:00Z'),
                output: boundary.parse((value) => {
                  parsed++
                  if (!(value instanceof Date)) throw new Error('expected Date')
                  return value
                }),
              },
            }),
          }),
        }),
    )
    const store = createMemoryStore()
    const run = wizard.create({}, { store, autoSave: 'off', key: 'date' })
    await run.start()
    expect(run.getState().output).toEqual(new Date('2026-10-13T00:00:00Z'))
    expect(parsed).toBe(1)
    await expect(run.save()).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_SERIALIZABLE' })
    expect(await store.get('date')).toBeNull()
    run.dispose()
  })

  it('saves and revives Date results through the declared step output without callback replay', async () => {
    let callbacks = 0
    const wizard = defineWizard(
      { name: 'returned-date-with-output', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          stamp: step({
            run: () => {
              callbacks++
              return {
                [RUN_ADAPTER]: {
                  run: () => new Date('2026-10-13T00:00:00Z'),
                  output: boundary.trusted<Date>(),
                },
              }
            },
            output: z.coerce.date(),
          }),
        }),
    )
    const store = createMemoryStore()
    const run = wizard.create({}, { store, autoSave: 'off', key: 'date' })
    await run.start()
    await run.save()
    const saved = await store.get('date')
    run.dispose()
    const resumed = wizard.resume(saved)
    expect(await resumed.awaitResult()).toMatchObject({
      status: 'done',
      output: new Date('2026-10-13T00:00:00Z'),
    })
    expect(resumed.getState().steps.stamp.output).toBeInstanceOf(Date)
    expect(callbacks).toBe(1)
    resumed.dispose()
  })
})
