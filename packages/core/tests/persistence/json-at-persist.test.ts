/**
 * JSON safety is enforced BEFORE every store write (plan §8.8): a snapshot that `JSON.stringify`
 * would distort is not written; the failure is a value on `onPersistError` and a `persist.failed`
 * event, with the exact path. `Date`s (any `toJSON()` object) are accepted only where a schema /
 * parse boundary re-parses them on resume — and then they do come back as `Date`s.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { WizardError } from '../../src/errors'
import { createMemoryStore } from '../../src/persistence/memory-store'
import type { RunEvent } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('persistence: JSON-checked before every store write', () => {
  const dates = { name: 'dates', context: z.object({ tenant: z.string() }) }

  it('a task output holding a Date (no output boundary) is not written: onPersistError + persist.failed name the path; getSnapshot() stays live', async () => {
    const stamped = defineWizard(dates, ({ step, steps }) =>
      steps(
        {
          save: step({
            run: () => ({ id: 'row-1', createdAt: new Date(1_700_000_000_000) }),
            next: 'end',
          }),
          end: step({}),
        },
        { start: 'save' },
      ),
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const events: RunEvent<typeof stamped>[] = []
    const run = stamped.create(
      { tenant: 't1' },
      {
        store,
        key: 'dates/1',
        onPersistError: (error) => errors.push(error),
      },
    )
    run.observe((event) => events.push(event))
    await run.start()
    await tick()
    expect(run.getState().status).toBe('done')
    // The live snapshot still holds the Date …
    expect(run.getSnapshot().state.steps.save.output?.createdAt).toBeInstanceOf(Date)
    // … but nothing with a Date in it reached the store (the task ran in the first drain, so no
    // snapshot at all was written).
    expect(await store.get('dates/1')).toBeNull()

    expect(errors.length).toBeGreaterThan(0)
    const error = errors[0]
    expect(error).toBeInstanceOf(WizardError)
    if (!(error instanceof WizardError)) return
    expect(error.code).toBe('SNAPSHOT_NOT_SERIALIZABLE')
    expect(error.message).toContain(
      'state.steps.save.output.createdAt is a Date (not a plain object)',
    )
    expect(error.message).toMatch(/z\.coerce\.date\(\)/)
    expect(error.step).toBe('save')
    expect(error.issues?.[0]?.path).toEqual(['state', 'steps', 'save', 'output', 'createdAt'])

    const failed = events.filter((e) => e.type === 'persist.failed')
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0]).toMatchObject({
      type: 'persist.failed',
      reason: 'not-serializable',
      key: 'dates/1',
      location: 'state.steps.save.output.createdAt',
      path: [],
    })
    expect(failed[0]?.seq).toBe(run.getState().seq) // the seq of the snapshot that failed to persist
    expect(run.log().some((e) => e.type === 'persist.failed')).toBe(true)

    // A manual save() rejects with the same error (and records the event again).
    await expect(run.save()).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_SERIALIZABLE' })
    run.dispose()
  })

  it('every other non-JSON value is caught with its path (Map, Set, RegExp, class instance, function, undefined slot, bigint, NaN)', async () => {
    class Money {
      constructor(readonly cents: number) {}
    }
    const values: Record<string, unknown> = {
      map: new Map([['a', 1]]),
      set: new Set([1]),
      regexp: /x/,
      money: new Money(1),
      fn: () => 1,
      holes: [1, undefined],
      big: 10n,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
    }
    for (const [name, value] of Object.entries(values)) {
      const wizard = defineWizard(dates, ({ step, steps }) =>
        steps(
          {
            t: step({ run: () => ({ [name]: value }), next: 'end' }),
            end: step({}),
          },
          { start: 't' },
        ),
      )
      const errors: WizardError[] = []
      const run = wizard.create(
        { tenant: 't1' },
        {
          store: createMemoryStore(),
          onPersistError: (error) => {
            if (error instanceof WizardError) errors.push(error)
          },
        },
      )
      await run.start()
      await tick()
      expect(errors[0]?.code, name).toBe('SNAPSHOT_NOT_SERIALIZABLE')
      expect(errors[0]?.message, name).toContain(
        `state.steps.t.output.${name}${name === 'holes' ? '[1]' : ''} is`,
      )
      run.dispose()
    }
  })

  it('an undefined PROPERTY is tolerated (JSON.stringify omits it), like a real store would', async () => {
    const wizard = defineWizard(dates, ({ step, steps }) =>
      steps(
        {
          t: step({ run: () => ({ id: 'x', note: undefined }), next: 'end' }),
          end: step({}),
        },
        { start: 't' },
      ),
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const run = wizard.create(
      { tenant: 't1' },
      {
        store,
        key: 'k',
        onPersistError: (error) => errors.push(error),
      },
    )
    await run.start()
    await tick()
    expect(errors).toEqual([])
    const saved = (await store.get('k')) as { state: { steps: { t: { output: unknown } } } }
    expect(saved.state.steps.t.output).toEqual({ id: 'x' })
    run.dispose()
  })

  it('a Date under a reviving boundary (task `output` with z.coerce.date()) is written as JSON and comes back as a Date after resume', async () => {
    const stamped = defineWizard(dates, ({ step, view, steps }) => {
      const save = step({
        run: () => ({ id: 'row-1', createdAt: new Date(1_700_000_000_000) }),
        output: z.object({ id: z.string(), createdAt: z.coerce.date() }),
        next: 'gate',
      })
      return steps(
        {
          save,
          gate: view({ input: z.object({ ok: z.literal(true) }), next: 'end' }),
          end: step({ needs: { save }, dependsOn: ['gate'], run: ({ needs }) => needs.save }),
        },
        { start: 'save' },
      )
    })
    const store = createMemoryStore()
    const errors: unknown[] = []
    const run = stamped.create(
      { tenant: 't1' },
      {
        store,
        key: 'dates/2',
        onPersistError: (error) => errors.push(error),
      },
    )
    await run.start()
    await tick()
    expect(run.getState().current).toBe('gate')
    expect(run.getState().steps.save.output?.createdAt).toBeInstanceOf(Date)
    expect(errors).toEqual([])
    // The store holds the JSON form …
    const raw = (await store.get('dates/2')) as {
      state: { steps: { save: { output: { createdAt: unknown } } } }
    }
    expect(raw.state.steps.save.output.createdAt).toBe('2023-11-14T22:13:20.000Z')
    run.dispose()

    // … and resume re-parses it through the boundary: a Date again, same instant.
    const resumed = stamped.resume(raw, { store, key: 'dates/2' })
    const revived = resumed.getState().steps.save.output?.createdAt
    expect(revived).toBeInstanceOf(Date)
    expect(revived?.getTime()).toBe(1_700_000_000_000)
    resumed.dispose()
  })

  it('a Date in the context is fine when the context boundary re-parses it (z.coerce.date()), and rejected under boundary.trusted()', async () => {
    const coerced = {
      name: 'ctx-dates',
      context: z.object({ since: z.coerce.date() }),
    }
    const okWizard = defineWizard(coerced, ({ step, steps }) => steps({ end: step({}) }))
    const errors: unknown[] = []
    const store = createMemoryStore()
    const run = okWizard.create(
      { since: '2024-01-01T00:00:00.000Z' },
      {
        store,
        key: 'ctx',
        onPersistError: (error) => errors.push(error),
      },
    )
    expect(run.getState().context.since).toBeInstanceOf(Date)
    await run.save()
    expect(errors).toEqual([])
    const resumed = okWizard.resume(await store.get('ctx'))
    expect(resumed.getState().context.since).toBeInstanceOf(Date)
    resumed.dispose()
    run.dispose()

    const trusted = {
      name: 'ctx-trusted',
      context: boundary.trusted<{ readonly since: Date }>(),
    }
    const trustedWizard = defineWizard(trusted, ({ step, steps }) => steps({ end: step({}) }))
    const bad = trustedWizard.create(
      { since: new Date() },
      {
        store: createMemoryStore(),
        onPersistError: () => {},
      },
    )
    await expect(bad.save()).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_SERIALIZABLE',
      message: expect.stringContaining('state.context.since is a Date'),
    })
    bad.dispose()
  })

  it('a store rejection is reported the same way (persist.failed { reason: "store" })', async () => {
    const wizard = defineWizard(dates, ({ step, steps }) => steps({ end: step({}) }))
    const errors: unknown[] = []
    const run = wizard.create(
      { tenant: 't1' },
      {
        store: {
          get: async () => null,
          set: async () => {
            throw new Error('disk full')
          },
          delete: async () => {},
        },
        key: 'k',
        onPersistError: (error) => errors.push(error),
      },
    )
    await run.start()
    await tick()
    expect(errors.map((e) => (e as Error).message)).toEqual(['disk full'])
    expect(run.log().find((e) => e.type === 'persist.failed')).toMatchObject({
      reason: 'store',
      key: 'k',
      message: 'disk full',
    })
    run.dispose()
  })
})
