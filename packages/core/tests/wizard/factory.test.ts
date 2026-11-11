import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, defineWizard, WizardError } from '../../src'
import { inspect } from '../../src/inspect'
import { createRun } from '../../src/wizard/create-wizard'

describe('wizard definitions and bound constructors', () => {
  it('is the definition consumed by inspectors and its own runs', () => {
    const wizard = defineWizard(
      { name: 'hello', context: z.object({ name: z.string() }) },
      ({ step, steps }) =>
        steps({ greeting: step({ run: ({ context }) => `Hello, ${context.name}` }) }),
    )
    expect(inspect(wizard).name).toBe('hello')
    expect(wizard.runSync({ name: 'Ada' })).toMatchObject({ status: 'done', output: 'Hello, Ada' })
    expect(() => wizard.runSync({ name: 1 } as never)).toThrow('context rejected')
    const run = wizard.create({ name: 'Ada' })
    expect(run.wizard).toBe(wizard)
    expect('wizard' in wizard).toBe(false)
    run.dispose()
  })

  it('names the wizard on a snapshot and rejects one that names it another way', async () => {
    const wizard = defineWizard({ name: 'hello', context: z.object({}) }, ({ view, steps }) =>
      steps({ ask: view({ input: z.object({ name: z.string() }) }) }),
    )
    const run = wizard.create({})
    await run.start()
    const snapshot = run.getSnapshot()
    run.dispose()
    expect(snapshot.wizard).toEqual({ name: 'hello', version: 1 })
    expect(snapshot.state.wizard).toEqual({ name: 'hello', version: 1 })

    const { wizard: identity, ...envelope } = snapshot
    const { wizard: _stateIdentity, ...state } = snapshot.state
    const renamed = { ...envelope, flow: identity, state: { ...state, flow: identity } }
    const issues = (() => {
      try {
        wizard.resume(renamed)
      } catch (error) {
        if (error instanceof WizardError && error.code === 'SNAPSHOT_INCOMPATIBLE')
          return (error.issues ?? []).map((issue) => issue.message)
        throw error
      }
      return []
    })()
    expect(issues).toEqual([
      'wizard: expected { name, version }',
      'state.wizard: expected { name, version }',
    ])
  })

  it('awaits asynchronous runnable sinks', async () => {
    const wizard = defineWizard({ name: 'async', context: z.object({}) }, ({ step, steps }) =>
      steps({ answer: step({ run: async () => ({ answer: 42 }) }) }),
    )
    expect(await wizard.run({})).toMatchObject({ status: 'done', output: { answer: 42 } })
  })

  it('provides dependencies immutably and carries them into internal and child creators', async () => {
    const child = defineWizard(
      {
        name: 'child',
        context: z.object({}),
        deps: boundary.trusted<{ price: () => Promise<number>; tax: number }>(),
      },
      ({ step, steps }) =>
        steps({
          price: step({ run: async ({ deps }) => (await deps.price()) + deps.tax }),
        }),
    )
    const priced = child.provide({ price: async () => 10 })
    const ready = priced.provide({ tax: 2 })
    expect(ready).not.toBe(child)
    expect(child.providedDeps).toBeUndefined()
    expect(await ready.run({})).toMatchObject({ output: 12 })
    expect(await ready.run({}, { deps: { tax: 5 } })).toMatchObject({ output: 15 })
    expect(await priced.run({}, { deps: { tax: 1 } })).toMatchObject({ output: 11 })
    const internal = createRun(ready, { context: {} })
    await internal.start()
    expect(await internal.awaitOutcome()).toMatchObject({ output: 12 })
    internal.dispose()
    const parent = defineWizard({ name: 'parent', context: z.object({}) }, ({ child, steps }) =>
      steps({ price: child(ready, { context: () => ({}) }) }),
    )
    expect(await parent.run({})).toMatchObject({ output: 12 })
  })

  it('creates independent interactive runs and resumes JSON snapshots', async () => {
    const form = defineWizard({ name: 'form', context: z.object({}) }, ({ view, step, steps }) =>
      steps({
        contact: view({ input: z.object({ email: z.email() }), next: 'done' }),
        done: step({ run: () => 'submitted' }),
      }),
    )
    const first = form.create({})
    const second = form.create({})
    await first.start()
    expect(second.getState().status).toBe('idle')
    const resumed = form.resume(JSON.parse(JSON.stringify(first.getSnapshot())))
    await resumed.setInput('contact', { email: 'ada@example.com' })
    expect((await resumed.next()).ok).toBe(true)
    expect(resumed.result()).toMatchObject({ status: 'done', output: 'submitted' })
    first.dispose()
    second.dispose()
    resumed.dispose()
    expect(form.runSync({})).toMatchObject({
      status: 'waiting',
      waitingFor: [{ kind: 'view', path: [], step: 'contact' }],
    })
  })

  it('validates graph references at definition time for JavaScript callers', () => {
    expect(() =>
      defineWizard({ name: 'bad', context: z.object({}) }, ({ view, steps }) =>
        steps({ a: view({ input: z.object({}), next: 'missing' }) } as never),
      ),
    ).toThrow()
  })

  it('awaits asynchronous creation and restoration boundaries', async () => {
    const wizard = defineWizard(
      {
        name: 'async-boundary',
        context: z.object({ name: z.string() }).refine(async () => true),
      },
      ({ step, steps }) => steps({ done: step({ run: ({ context }) => context.name }) }),
    )
    const run = await wizard.createAsync({ name: 'Ada' })
    const resumed = await wizard.resumeAsync(run.getSnapshot())
    await resumed.start()
    expect(resumed.result()).toMatchObject({ output: 'Ada' })
    run.dispose()
    resumed.dispose()
    expect(await wizard.run({ name: 'Lin' })).toMatchObject({ output: 'Lin' })
  })

  it('returns failures and names asynchronous work in runSync errors', async () => {
    const wizard = defineWizard(
      { name: 'failure', context: z.object({}), onFailure: 'compensate' },
      ({ step, steps }) =>
        steps({
          work: step({
            run: async () => {
              throw new Error('offline')
            },
          }),
        }),
    )
    expect(await wizard.run({})).toMatchObject({ status: 'failed' })
    expect(() => wizard.runSync({})).toThrow("runSync: step 'work' returned a promise")
  })
})
