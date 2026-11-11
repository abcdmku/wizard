import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { eachItem } from '../../src/machine/each-state'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('map result persistence', () => {
  it('persists and revives the terminal result through the last completed sink boundary', async () => {
    const wizard = defineWizard(
      { name: 'terminal-each-dates', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          stamp: step({
            each: () => [0, 1],
            run: ({ item }) => ({ at: new Date(1_700_000_000_000 + item) }),
            output: z.object({ at: z.coerce.date() }),
          }),
        }),
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const run = wizard.create(
      {},
      { store, key: 'terminal-map', onPersistError: (error) => errors.push(error) },
    )
    await run.start()
    expect(run.getState().status).toBe('done')
    await run.save()
    expect(errors).toEqual([])
    const raw = await store.get('terminal-map')
    run.dispose()

    const resumed = wizard.resume(raw)
    expect(resumed.getState().output).toEqual([
      { at: new Date(1_700_000_000_000) },
      { at: new Date(1_700_000_000_001) },
    ])
    const result = await resumed.awaitResult()
    expect(result.status).toBe('done')
    if (result.status !== 'done') throw new Error('expected restored terminal result')
    expect(result.output).toEqual([
      { at: new Date(1_700_000_000_000) },
      { at: new Date(1_700_000_000_001) },
    ])
    resumed.dispose()
  })

  it('revives completed item outputs and the ordered result without running items again', async () => {
    let calls = 0
    const wizard = defineWizard(
      { name: 'each-dates', context: z.object({}) },
      ({ step, view, steps }) =>
        steps({
          stamp: step({
            each: () => Array.from({ length: 65 }, (_, index) => index),
            run: ({ item }) => {
              calls++
              return { at: new Date(1_700_000_000_000 + item) }
            },
            output: z.object({ at: z.coerce.date() }),
            next: 'gate',
          }),
          gate: view({ input: z.object({ approved: z.boolean() }) }),
        }),
    )
    const errors: unknown[] = []
    const store = createMemoryStore()
    const run = wizard.create(
      {},
      { store, key: 'map', onPersistError: (error) => errors.push(error) },
    )
    await run.start()
    await run.whenIdle()
    await run.save()
    expect(errors).toEqual([])
    expect(calls).toBe(65)
    expect(run.getState().steps.stamp.output?.[64]?.at).toBeInstanceOf(Date)
    const raw = await store.get('map')
    run.dispose()

    const resumed = wizard.resume(raw)
    expect(resumed.getState().steps.stamp.output?.[64]?.at.getTime()).toBe(1_700_000_000_064)
    const each = resumed.getSnapshot().state.steps.stamp.each
    expect(each).toBeDefined()
    if (each === undefined) throw new Error('missing persisted map records')
    expect(eachItem(each, 64).output).toEqual({ at: new Date(1_700_000_000_064) })
    await resumed.whenIdle()
    expect(calls).toBe(65)
    resumed.dispose()
  })

  it('revives a finished item in a halted map before retrying only the failed item', async () => {
    let fail = true
    const calls: number[] = []
    const wizard = defineWizard(
      { name: 'partial-each-dates', context: z.object({}) },
      ({ step, view, steps }) =>
        steps({
          stamp: step({
            each: () => [0, 1],
            concurrency: 1,
            run: ({ item }) => {
              calls.push(item)
              if (item === 1 && fail) throw new Error('try again')
              return { at: new Date(1_700_000_000_000 + item) }
            },
            output: z.object({ at: z.coerce.date() }),
            next: 'gate',
          }),
          gate: view({ input: z.object({ approved: z.boolean() }) }),
        }),
    )
    const store = createMemoryStore()
    const run = wizard.create({}, { store, key: 'partial-map' })
    await run.start()
    await run.whenIdle()
    expect(run.getState().status).toBe('halted')
    expect(calls).toEqual([0, 1])
    await run.save()
    const raw = await store.get('partial-map')
    run.dispose()

    const resumed = wizard.resume(raw)
    const each = resumed.getSnapshot().state.steps.stamp.each
    expect(each).toBeDefined()
    if (each === undefined) throw new Error('missing persisted map records')
    expect(eachItem(each, 0).output).toEqual({ at: new Date(1_700_000_000_000) })
    fail = false
    expect((await resumed.retry('stamp')).ok).toBe(true)
    await resumed.whenIdle()
    expect(calls).toEqual([0, 1, 1])
    expect(resumed.getState().steps.stamp.output).toEqual([
      { at: new Date(1_700_000_000_000) },
      { at: new Date(1_700_000_000_001) },
    ])
    resumed.dispose()
  })

  it('revives schema context in each child snapshot using the indexed child address', async () => {
    const child = defineWizard(
      { name: 'each-date-child', context: z.object({ since: z.coerce.date() }) },
      ({ view, steps }) => steps({ gate: view({ input: z.object({ approved: z.boolean() }) }) }),
    )
    const wizard = defineWizard(
      { name: 'each-date-parent', context: z.object({}) },
      ({ flow, steps }) =>
        steps({
          stamp: flow(child, {
            each: () => [0, 1],
            key: (item) => `date/${item}`,
            context: ({ item }) => ({ since: new Date(1_700_000_000_000 + item) }),
          }),
        }),
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const run = wizard.create(
      {},
      { store, key: 'child-map', onPersistError: (error) => errors.push(error) },
    )
    await run.start()
    await run.whenIdle()
    expect(Object.keys(run.getSnapshot().children)).toHaveLength(2)
    await run.save()
    expect(errors).toEqual([])
    const raw = await store.get('child-map')
    run.dispose()

    const resumed = wizard.resume(raw)
    expect(
      Object.values(resumed.getSnapshot().children).map(
        (snapshot) => snapshot?.state.context.since,
      ),
    ).toEqual([new Date(1_700_000_000_000), new Date(1_700_000_000_001)])
    expect(resumed.waitingFor()).toHaveLength(2)
    resumed.dispose()
  })
})
