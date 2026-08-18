/**
 * v0.2 end-to-end with the REAL machine — `mapError` data, idempotent crash-resume and `migrate`.
 */
import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../../src/authoring/compiled'
import { WizardError } from '../../../src/errors'
import { createSequentialIds } from '../../../src/interpreter/env'
import { createTestScheduler } from '../../../src/interpreter/test-scheduler'
import { initialState, machine } from '../../../src/machine/index'
import { createMemoryStore } from '../../../src/persistence/memory-store'
import { resumeWizardRuntime, resumeWizardRuntimeAsync } from '../../../src/wizard/resume'
import { createWizardRuntime } from '../../../src/wizard/runtime'
import { final, flow, task, view } from '../../helpers/fixtures'
import { e2e, e2eResume, roundTrip, tick } from './harness'

describe('e2e v0.2 — mapError', () => {
  class HttpError extends Error {
    constructor(readonly status: number) {
      super(`http ${status}`)
      this.name = 'HttpError'
    }
  }

  it('the mapper receives the RAW thrown error; its value is StepError.data, persisted and restored', async () => {
    const store = createMemoryStore()
    const def = flow({
      name: 'map',
      start: 't',
      steps: {
        t: task({
          run: () => {
            throw new HttpError(503)
          },
          mapError: ({ error }: HookArgs) => ({
            status: error instanceof HttpError ? error.status : -1,
            retryable: error instanceof HttpError && error.status >= 500,
          }),
          retry: { attempts: 1, backoff: 50 },
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def, { store, key: 'k' })
    await t.wizard.start()
    expect(t.rec('t').error).toMatchObject({ kind: 'run', data: { status: 503, retryable: true } })
    expect(t.of('step.runFailed')[0]).toMatchObject({ data: { status: 503, retryable: true } })
    t.sched.advance(50)
    expect(t.rec('t')).toMatchObject({ status: 'failed', error: { data: { status: 503 } } })
    expect(t.of('step.failed')[0]).toMatchObject({ data: { status: 503, retryable: true } })
    await t.wizard.save()
    const saved = (await store.get('k')) as { state: { steps: { t: { error: unknown } } } }
    expect(saved.state.steps.t.error).toMatchObject({ data: { status: 503, retryable: true } })
    // resume keeps it
    const r = e2eResume(def, roundTrip(t.wizard.getSnapshot()))
    expect(r.rec('t').error).toMatchObject({ data: { status: 503, retryable: true } })
  })

  it('a non-JSON mapError value fails the persist loudly (persist.failed names the path)', async () => {
    const store = createMemoryStore()
    const errors: unknown[] = []
    const def = flow({
      name: 'map-bad',
      start: 't',
      steps: {
        t: task({
          run: () => {
            throw new Error('x')
          },
          mapError: () => ({ at: new Date(0) }),
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def, { store, key: 'k', onPersistError: (e) => errors.push(e) })
    await t.wizard.start()
    await tick()
    expect(errors).toHaveLength(1)
    expect((errors[0] as WizardError).code).toBe('SNAPSHOT_NOT_SERIALIZABLE')
    expect(t.of('persist.failed')[0]).toMatchObject({
      reason: 'not-serializable',
      location: 'state.steps.t.error.data.at',
    })
  })
})

describe('e2e v0.2 — idempotent crash-resume and migrate', () => {
  it('a running idempotent task is re-run after resume with the same key (step.runStarted{resumed:true}); the run sees args.idempotencyKey', async () => {
    const keys: string[] = []
    let calls = 0
    const def = flow({
      name: 'idem',
      start: 't',
      steps: {
        t: task({
          idempotent: true,
          idempotencyKey: ({ context }) => `reserve:${(context as { orderId: string }).orderId}`,
          run: ({ idempotencyKey }) => {
            keys.push(idempotencyKey)
            calls += 1
            return calls === 1 ? new Promise(() => {}) : 'done'
          },
          next: 'end',
        }),
        end: final(),
      },
    })
    const a = e2e(def, { context: { orderId: 'o1' } })
    await a.wizard.start()
    expect(a.rec('t')).toMatchObject({ status: 'active', attempt: 1, idempotencyKey: 'reserve:o1' })
    const snap = roundTrip(a.wizard.getSnapshot())
    a.wizard.dispose()
    const b = e2eResume(def, snap)
    expect(b.of('step.runStarted')[0]).toMatchObject({
      attempt: 1,
      idempotencyKey: 'reserve:o1',
      resumed: true,
    })
    expect(b.rec('t')).toMatchObject({ status: 'done', output: 'done' })
    expect(keys).toEqual(['reserve:o1', 'reserve:o1'])
    expect(b.wizard.getState().status).toBe('done')
  })

  const v1 = flow({
    name: 'mig',
    version: 1,
    start: 'a',
    steps: { a: view({ next: 'end' }), end: final() },
  })
  const v2 = flow({
    name: 'mig',
    version: 2,
    start: 'a',
    steps: { a: view({ next: 'b' }), b: view({ next: 'end' }), end: final() },
  })
  const opts = () => ({
    machine,
    initialState,
    scheduler: createTestScheduler({ now: 1 }),
    ids: createSequentialIds(),
  })
  const upgrade = (snapshot: unknown) => {
    const s = snapshot as { flow: object; state: { steps: Record<string, unknown> } }
    return {
      ...s,
      flow: { name: 'mig', version: 2 },
      state: {
        ...s.state,
        flow: { name: 'mig', version: 2 },
        steps: {
          ...s.state.steps,
          b: {
            id: 'b',
            kind: 'view',
            status: 'idle',
            attempt: 0,
            runId: 0,
            guards: {},
            visitedCount: 0,
            pendingActivation: false,
          },
        },
      },
    }
  }

  it('migrate runs on a version mismatch (sync); its result is validated; the name must match; a promise needs the async door', async () => {
    const w1 = createWizardRuntime(v1, { ...opts(), context: {}, instanceId: 'm' })
    await w1.start()
    const snap = roundTrip(w1.getSnapshot())
    w1.dispose()
    // without migrate: incompatible
    expect(() => resumeWizardRuntime(v2, snap, opts())).toThrow(WizardError)
    // sync migrate
    const from: unknown[] = []
    const w2 = resumeWizardRuntime(v2, snap, {
      ...opts(),
      migrate: (s, f) => {
        from.push(f)
        return upgrade(s)
      },
    })
    expect(from).toEqual([{ name: 'mig', version: 1 }])
    expect(w2.getState().flow).toEqual({ name: 'mig', version: 2 })
    expect(w2.getState().current).toBe('a')
    expect(w2.epoch).toBe(1)
    expect(await w2.next()).toMatchObject({ ok: true, to: 'b' })
    // a migration that forgets to bump the version is rejected like any snapshot
    try {
      resumeWizardRuntime(v2, snap, { ...opts(), migrate: (s) => s })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as WizardError).issues?.map((i) => i.message)).toContain(
        'flow.version: expected 2, got 1',
      )
    }
    // a name mismatch never migrates
    let called = 0
    const other = flow({ name: 'other', version: 2, start: 'a', steps: v1.steps })
    expect(() =>
      resumeWizardRuntime(other, snap, {
        ...opts(),
        migrate: () => {
          called += 1
          return snap
        },
      }),
    ).toThrow(WizardError)
    expect(called).toBe(0)
    // a thenable on the sync door → SNAPSHOT_INCOMPATIBLE pointing to the async door
    try {
      resumeWizardRuntime(v2, snap, { ...opts(), migrate: async (s) => upgrade(s) })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as WizardError).code).toBe('SNAPSHOT_INCOMPATIBLE')
      expect((error as WizardError).issues?.[0]?.message).toContain('resumeWizardAsync')
    }
    // a throwing migrate is a reason too
    try {
      resumeWizardRuntime(v2, snap, {
        ...opts(),
        migrate: () => {
          throw new Error('nope')
        },
      })
      throw new Error('expected throw')
    } catch (error) {
      expect((error as WizardError).issues?.[0]?.message).toBe('migrate: threw (nope)')
    }
  })

  it('resumeWizardRuntimeAsync awaits an async migrate (and accepts a sync one); rejections are SNAPSHOT_INCOMPATIBLE', async () => {
    const w1 = createWizardRuntime(v1, { ...opts(), context: {}, instanceId: 'm' })
    await w1.start()
    const snap = roundTrip(w1.getSnapshot())
    w1.dispose()
    const w2 = await resumeWizardRuntimeAsync(v2, snap, {
      ...opts(),
      migrate: async (s) => {
        await tick()
        return upgrade(s)
      },
    })
    expect(w2.getState().flow.version).toBe(2)
    const w3 = await resumeWizardRuntimeAsync(v2, snap, { ...opts(), migrate: upgrade })
    expect(w3.getState().flow.version).toBe(2)
    await expect(
      resumeWizardRuntimeAsync(v2, snap, {
        ...opts(),
        migrate: async () => Promise.reject(new Error('bad')),
      }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPATIBLE' })
    // same version: migrate is not consulted
    let called = 0
    const same = await resumeWizardRuntimeAsync(v2, roundTrip(w2.getSnapshot()), {
      ...opts(),
      migrate: () => {
        called += 1
        return undefined
      },
    })
    expect(called).toBe(0)
    expect(same.getState().flow.version).toBe(2)
  })
})
