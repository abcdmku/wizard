/**
 * `resumeWizardAsync` (review finding 10): flows whose boundaries are asynchronous Standard
 * Schemas (context, view input, event payload, a nested child's context) resume through the
 * async door — every boundary is awaited before any runtime exists (atomic; a rejection lists
 * every reason and nothing runs) — while the sync `resumeWizard` reports each async boundary
 * as a reason pointing to the async variant.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { createWizardAsync, resumeWizard, resumeWizardAsync } from '../../src/wizard/create-wizard'

/** An async Standard Schema: `validate` resolves later; `check` may reject; every call is counted. */
function asyncSchema<T>(
  check: (value: unknown) => T,
  calls: string[],
  name: string,
): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        new Promise((resolve) =>
          setTimeout(() => {
            calls.push(name)
            try {
              resolve({ value: check(value) })
            } catch (error) {
              resolve({ issues: [{ message: (error as Error).message }] })
            }
          }, 0),
        ),
    },
  }
}

describe('resumeWizardAsync', () => {
  const setup = () => {
    const calls: string[] = []
    const str = (what: string) => (v: unknown) => {
      if (typeof v !== 'object' || v === null) throw new Error(`${what}: not an object`)
      return v as Record<string, string>
    }
    const c = defineFlow({
      name: 'child',
      context: asyncSchema(str('child.context'), calls, 'child.context'),
    })
    const child = c.steps({ v: c.view({ next: 'end' }), end: c.final() })
    const s = defineFlow({
      name: 'async-flow',
      context: asyncSchema(str('context'), calls, 'context'),
      events: { ping: asyncSchema(str('ping'), calls, 'ping') },
    })
    const flow = s.steps(
      {
        form: s.view({
          input: asyncSchema(str('form.input'), calls, 'form.input'),
          next: 'sub',
        }),
        sub: s.flow(child, { context: () => ({ n: '1' }), next: 'wait' }),
        wait: s.wait({ on: { ping: () => {} }, next: 'end' }),
        end: s.final(),
      },
      { start: 'form' },
    )
    return { flow, calls }
  }

  it('resumes a flow with async context / view input / inbox / nested-child boundaries; the sync door refuses with a pointer', async () => {
    const { flow, calls } = setup()
    const store = createMemoryStore()
    const wizard = await createWizardAsync(flow, {
      context: { a: '1' },
      store,
      key: 'k',
      scheduler: createTestScheduler({ now: 1_000 }),
      ids: createSequentialIds(),
      instanceId: 'w-1',
    })
    await wizard.start()
    // An early event lands in the inbox (no wait step active yet).
    expect(await wizard.send('ping', { p: '1' })).toMatchObject({ ok: true, buffered: true })
    await wizard.setInput('form', { field: 'x' })
    expect(await wizard.next()).toMatchObject({ ok: true, from: 'form', to: 'sub' })
    // The child was created (async context boundary → after a tick) and waits on its view.
    await new Promise((r) => setTimeout(r, 5))
    expect(wizard.child('sub').getState().current).toBe('v')
    await wizard.save()
    const saved = await store.get('k')
    wizard.dispose()
    calls.length = 0

    // Sync resume: every async boundary is a reason, naming the async variant.
    try {
      resumeWizard(flow, saved, {})
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      const reasons = (error as WizardError).issues?.map((i) => i.message) ?? []
      expect(reasons).toEqual([
        'context: async boundaries are not supported by resumeWizard (use resumeWizardAsync)',
        'children.sub.context: async boundaries are not supported by resumeWizard (use resumeWizardAsync)',
        'steps.form.output: async boundaries are not supported by resumeWizard (use resumeWizardAsync)',
        'inbox[0].payload: async boundaries are not supported by resumeWizard (use resumeWizardAsync)',
      ])
    }

    // (The sync attempt above still kicked off the async validators; let them settle and forget them.)
    await new Promise((r) => setTimeout(r, 5))
    calls.length = 0

    // Async resume: all four boundaries awaited (once each), then the tree is instantiated.
    const resumed = await resumeWizardAsync(flow, saved, {
      scheduler: createTestScheduler({ now: 2_000 }),
      ids: createSequentialIds(),
    })
    expect(calls.sort()).toEqual(['child.context', 'context', 'form.input', 'ping'])
    expect(resumed.epoch).toBe(1)
    expect(resumed.getState().steps.form.output).toEqual({ field: 'x' })
    expect(resumed.getState().inbox[0]?.payload).toEqual({ p: '1' })
    expect(resumed.child('sub').getState().current).toBe('v')
    expect(resumed.child('sub').epoch).toBe(1)
    // The resumed tree keeps working: finish the child, the inbox event resolves the wait.
    expect(
      await resumed.dispatch({ type: 'child', path: ['sub'], command: { type: 'next' } }),
    ).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 5))
    expect(resumed.getState().status).toBe('done')
    resumed.dispose()
  })

  it('is atomic: a rejecting async boundary lists every reason and instantiates nothing', async () => {
    const { flow } = setup()
    const store = createMemoryStore()
    const wizard = await createWizardAsync(flow, { context: { a: '1' }, store, key: 'k' })
    await wizard.start()
    await wizard.save()
    const saved = (await store.get('k')) as { state: { context: unknown } }
    wizard.dispose()
    const broken = { ...saved, state: { ...saved.state, context: 'not-an-object' } }
    await expect(resumeWizardAsync(flow, broken, {})).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof WizardError &&
        error.code === 'SNAPSHOT_INCOMPATIBLE' &&
        (error.issues ?? []).some(
          (i) => i.message === 'context: rejected by boundary (context: not an object)',
        ),
    )
  })

  it('a deps boundary is awaited too (async deps at the door)', async () => {
    const calls: string[] = []
    const s = defineFlow({
      name: 'deps',
      context: boundary.trusted<{ n: number }>(),
      deps: asyncSchema((v) => v as { svc: string }, calls, 'deps'),
    })
    const flow = s.steps({ v: s.view({ next: 'end' }), end: s.final() })
    const store = createMemoryStore()
    const wizard = await createWizardAsync(flow, {
      context: { n: 1 },
      deps: { svc: 'a' },
      store,
      key: 'k',
    })
    await wizard.start()
    await wizard.save()
    wizard.dispose()
    const resumed = await resumeWizardAsync(flow, await store.get('k'), { deps: { svc: 'b' } })
    expect(calls).toEqual(['deps', 'deps'])
    expect(resumed.getState().current).toBe('v')
    resumed.dispose()
  })
})
