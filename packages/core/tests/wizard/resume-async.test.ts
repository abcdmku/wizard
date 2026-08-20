/**
 * `resumeRunAsync` (review finding 10): flows whose boundaries are asynchronous Standard
 * Schemas (context, view input, event payload, a nested child's context) resume through the
 * async door — every boundary is awaited before any runtime exists (atomic; a rejection lists
 * every reason and nothing runs) — while the sync `resumeRun` reports each async boundary
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
import { createRunAsync, resumeRun, resumeRunAsync } from '../../src/wizard/create-wizard'

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

describe('resumeRunAsync', () => {
  const setup = () => {
    const calls: string[] = []
    const str = (what: string) => (v: unknown) => {
      if (typeof v !== 'object' || v === null) throw new Error(`${what}: not an object`)
      return v as Record<string, string>
    }
    const child = defineFlow({
      name: 'child',
      context: asyncSchema(str('child.context'), calls, 'child.context'),
    })
    const childFlow = child.steps({ v: child.view({ next: 'end' }), end: child.final() })
    const asyncFlow = defineFlow({
      name: 'async-flow',
      context: asyncSchema(str('context'), calls, 'context'),
      events: { ping: asyncSchema(str('ping'), calls, 'ping') },
    })
    const flow = asyncFlow.steps(
      {
        form: asyncFlow.view({
          input: asyncSchema(str('form.input'), calls, 'form.input'),
          next: 'sub',
        }),
        sub: asyncFlow.flow(childFlow, { context: () => ({ n: '1' }), next: 'wait' }),
        wait: asyncFlow.wait({ on: { ping: () => {} }, next: 'end' }),
        end: asyncFlow.final(),
      },
      { start: 'form' },
    )
    return { flow, calls }
  }

  it('resumes a flow with async context / view input / inbox / nested-child boundaries; the sync door refuses with a pointer', async () => {
    const { flow, calls } = setup()
    const store = createMemoryStore()
    const run = await createRunAsync(flow, {
      context: { a: '1' },
      store,
      key: 'k',
      scheduler: createTestScheduler({ now: 1_000 }),
      ids: createSequentialIds(),
      instanceId: 'w-1',
    })
    await run.start()
    // An early event lands in the inbox (no wait step active yet).
    expect(await run.send('ping', { p: '1' })).toMatchObject({ ok: true, buffered: true })
    await run.setInput('form', { field: 'x' })
    expect(await run.next()).toMatchObject({ ok: true, from: 'form', to: 'sub' })
    // The child was created (async context boundary → after a tick) and waits on its view.
    await new Promise((r) => setTimeout(r, 5))
    expect(run.child('sub').getState().current).toBe('v')
    await run.save()
    const saved = await store.get('k')
    run.dispose()
    calls.length = 0

    // Sync resume: every async boundary is a reason, naming the async variant.
    try {
      resumeRun(flow, saved, {})
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      const reasons = (error as WizardError).issues?.map((i) => i.message) ?? []
      expect(reasons).toEqual([
        'context: async boundaries are not supported by resumeRun (use resumeRunAsync)',
        'children.sub.context: async boundaries are not supported by resumeRun (use resumeRunAsync)',
        'steps.form.output: async boundaries are not supported by resumeRun (use resumeRunAsync)',
        'inbox[0].payload: async boundaries are not supported by resumeRun (use resumeRunAsync)',
      ])
    }

    // (The sync attempt above still kicked off the async validators; let them settle and forget them.)
    await new Promise((r) => setTimeout(r, 5))
    calls.length = 0

    // Async resume: all four boundaries awaited (once each), then the tree is instantiated.
    const resumed = await resumeRunAsync(flow, saved, {
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
    const run = await createRunAsync(flow, { context: { a: '1' }, store, key: 'k' })
    await run.start()
    await run.save()
    const saved = (await store.get('k')) as { state: { context: unknown } }
    run.dispose()
    const broken = { ...saved, state: { ...saved.state, context: 'not-an-object' } }
    await expect(resumeRunAsync(flow, broken, {})).rejects.toSatisfy(
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
    const deps = defineFlow({
      name: 'deps',
      context: boundary.trusted<{ n: number }>(),
      deps: asyncSchema((v) => v as { svc: string }, calls, 'deps'),
    })
    const flow = deps.steps({ v: deps.view({ next: 'end' }), end: deps.final() })
    const store = createMemoryStore()
    const run = await createRunAsync(flow, {
      context: { n: 1 },
      deps: { svc: 'a' },
      store,
      key: 'k',
    })
    await run.start()
    await run.save()
    run.dispose()
    const resumed = await resumeRunAsync(flow, await store.get('k'), { deps: { svc: 'b' } })
    expect(calls).toEqual(['deps', 'deps'])
    expect(resumed.getState().current).toBe('v')
    resumed.dispose()
  })
})
