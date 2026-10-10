/**
 * JSON safety is enforced BEFORE every store write (plan §8.8): a snapshot that `JSON.stringify`
 * would distort is not written; the failure is a value on `onPersistError` and a `persist.failed`
 * event, with the exact path. `Date`s (any `toJSON()` object) are accepted only where a schema /
 * parse boundary re-parses them on resume — and then they do come back as `Date`s.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { createWizard, resumeWizard, type WizardEvent } from '../../src/wizard/create-wizard'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('persistence: JSON-checked before every store write', () => {
  const s = defineFlow({ name: 'dates', context: z.object({ tenant: z.string() }) })

  it('a task output holding a Date (no output boundary) is not written: onPersistError + persist.failed name the path; getSnapshot() stays live', async () => {
    const stamped = s.steps(
      {
        save: s.task(() => ({ id: 'row-1', createdAt: new Date(1_700_000_000_000) }), {
          next: 'end',
        }),
        end: s.final(),
      },
      { start: 'save' },
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const events: WizardEvent<typeof stamped>[] = []
    const wizard = createWizard(stamped, {
      context: { tenant: 't1' },
      store,
      key: 'dates/1',
      onPersistError: (error) => errors.push(error),
    })
    wizard.observe((event) => events.push(event))
    await wizard.start()
    await tick()
    expect(wizard.getState().status).toBe('done')
    // The live snapshot still holds the Date …
    expect(wizard.getSnapshot().state.steps.save.output?.createdAt).toBeInstanceOf(Date)
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
    expect(failed[0]?.seq).toBe(wizard.getState().seq) // the seq of the snapshot that failed to persist
    expect(wizard.log().some((e) => e.type === 'persist.failed')).toBe(true)

    // A manual save() rejects with the same error (and records the event again).
    await expect(wizard.save()).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_SERIALIZABLE' })
    wizard.dispose()
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
      const flow = s.steps(
        { t: s.task(() => ({ [name]: value }), { next: 'end' }), end: s.final() },
        { start: 't' },
      )
      const errors: WizardError[] = []
      const wizard = createWizard(flow, {
        context: { tenant: 't1' },
        store: createMemoryStore(),
        onPersistError: (error) => {
          if (error instanceof WizardError) errors.push(error)
        },
      })
      await wizard.start()
      await tick()
      expect(errors[0]?.code, name).toBe('SNAPSHOT_NOT_SERIALIZABLE')
      expect(errors[0]?.message, name).toContain(
        `state.steps.t.output.${name}${name === 'holes' ? '[1]' : ''} is`,
      )
      wizard.dispose()
    }
  })

  it('an undefined PROPERTY is tolerated (JSON.stringify omits it), like a real store would', async () => {
    const flow = s.steps(
      { t: s.task(() => ({ id: 'x', note: undefined }), { next: 'end' }), end: s.final() },
      { start: 't' },
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const wizard = createWizard(flow, {
      context: { tenant: 't1' },
      store,
      key: 'k',
      onPersistError: (error) => errors.push(error),
    })
    await wizard.start()
    await tick()
    expect(errors).toEqual([])
    const saved = (await store.get('k')) as { state: { steps: { t: { output: unknown } } } }
    expect(saved.state.steps.t.output).toEqual({ id: 'x' })
    wizard.dispose()
  })

  it('a Date under a reviving boundary (task `output` with z.coerce.date()) is written as JSON and comes back as a Date after resumeWizard', async () => {
    const stamped = s.steps(
      {
        save: s.task(() => ({ id: 'row-1', createdAt: new Date(1_700_000_000_000) }), {
          output: z.object({ id: z.string(), createdAt: z.coerce.date() }),
          next: 'gate',
        }),
        gate: s.view({ input: z.object({ ok: z.literal(true) }), next: 'end' }),
        end: s.final({ output: ({ steps }) => steps.save?.output }),
      },
      { start: 'save' },
    )
    const store = createMemoryStore()
    const errors: unknown[] = []
    const wizard = createWizard(stamped, {
      context: { tenant: 't1' },
      store,
      key: 'dates/2',
      onPersistError: (error) => errors.push(error),
    })
    await wizard.start()
    await tick()
    expect(wizard.getState().current).toBe('gate')
    expect(wizard.getState().steps.save.output?.createdAt).toBeInstanceOf(Date)
    expect(errors).toEqual([])
    // The store holds the JSON form …
    const raw = (await store.get('dates/2')) as {
      state: { steps: { save: { output: { createdAt: unknown } } } }
    }
    expect(raw.state.steps.save.output.createdAt).toBe('2023-11-14T22:13:20.000Z')
    wizard.dispose()

    // … and resume re-parses it through the boundary: a Date again, same instant.
    const resumed = resumeWizard(stamped, raw, { store, key: 'dates/2' })
    const revived = resumed.getState().steps.save.output?.createdAt
    expect(revived).toBeInstanceOf(Date)
    expect(revived?.getTime()).toBe(1_700_000_000_000)
    resumed.dispose()
  })

  it('a Date in the context is fine when the context boundary re-parses it (z.coerce.date()), and rejected under boundary.trusted()', async () => {
    const coerced = defineFlow({
      name: 'ctx-dates',
      context: z.object({ since: z.coerce.date() }),
    })
    const okFlow = coerced.steps({ end: coerced.final() })
    const errors: unknown[] = []
    const store = createMemoryStore()
    const wizard = createWizard(okFlow, {
      context: { since: '2024-01-01T00:00:00.000Z' },
      store,
      key: 'ctx',
      onPersistError: (error) => errors.push(error),
    })
    expect(wizard.getState().context.since).toBeInstanceOf(Date)
    await wizard.save()
    expect(errors).toEqual([])
    const resumed = resumeWizard(okFlow, await store.get('ctx'), {})
    expect(resumed.getState().context.since).toBeInstanceOf(Date)
    resumed.dispose()
    wizard.dispose()

    const trusted = defineFlow({
      name: 'ctx-trusted',
      context: boundary.trusted<{ readonly since: Date }>(),
    })
    const trustedFlow = trusted.steps({ end: trusted.final() })
    const bad = createWizard(trustedFlow, {
      context: { since: new Date() },
      store: createMemoryStore(),
      onPersistError: () => {},
    })
    await expect(bad.save()).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_SERIALIZABLE',
      message: expect.stringContaining('state.context.since is a Date'),
    })
    bad.dispose()
  })

  it('a store rejection is reported the same way (persist.failed { reason: "store" })', async () => {
    const flow = s.steps({ end: s.final() })
    const errors: unknown[] = []
    const wizard = createWizard(flow, {
      context: { tenant: 't1' },
      store: {
        get: async () => null,
        set: async () => {
          throw new Error('disk full')
        },
        delete: async () => {},
      },
      key: 'k',
      onPersistError: (error) => errors.push(error),
    })
    await wizard.start()
    await tick()
    expect(errors.map((e) => (e as Error).message)).toEqual(['disk full'])
    expect(wizard.log().find((e) => e.type === 'persist.failed')).toMatchObject({
      reason: 'store',
      key: 'k',
      message: 'disk full',
    })
    wizard.dispose()
  })
})
