/**
 * The typed façade tests `migrate` on resume through sync and async doors and hostile results,
 * shared references in a live snapshot, and definition drift.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { createRun, resumeRun, resumeRunAsync } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'
import { renameSteps } from '../../src/wizard/rename-steps'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
interface NodeLikeProcess {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}
describe('Run: migrate on resume', () => {
  const flowV1 = defineWizard(
    { name: 'approval', version: 1, context: z.object({ amount: z.number() }) },
    ({ steps, view, step }) => steps({ ask: view({ next: 'end' }), end: step({}) }),
  )
  const flowV2 = defineWizard(
    {
      name: 'approval',
      version: 2,
      context: z.object({ amount: z.number(), currency: z.string() }),
    },
    ({ steps, view, step }) => steps({ ask: view({ next: 'end' }), end: step({}) }),
  )
  it('calls migrate(snapshot, from) when the version differs; the result is stamped with the flow version', async () => {
    const store = createMemoryStore()
    const old = createRun(flowV1, { context: { amount: 5 }, store, key: 'k' })
    await old.start()
    await old.save()
    old.dispose()
    const saved = await store.get('k')
    const seen: unknown[] = []
    const resumed = resumeRun(flowV2, saved, {
      migrate: (snapshot, from) => {
        seen.push(from)
        const snap = snapshot as {
          flow: {
            name: string
            version: number
          }
          state: {
            flow: {
              name: string
              version: number
            }
            context: object
          }
        }
        // Both the envelope and the state carry the flow identity.
        return {
          ...snap,
          flow: { ...snap.flow, version: 2 },
          state: {
            ...snap.state,
            flow: { ...snap.state.flow, version: 2 },
            context: { ...snap.state.context, currency: 'EUR' },
          },
        }
      },
    })
    expect(seen).toEqual([{ name: 'approval', version: 1 }])
    expect(resumed.getState().context).toEqual({ amount: 5, currency: 'EUR' })
    expect(resumed.getState().current).toBe('ask')
    expect(resumed.epoch).toBe(1)
    resumed.dispose()
    // Without migrate the snapshot is incompatible. A migrated snapshot is stamped with the
    // flow's version, so an identity migrate fails only on what really changed (the context).
    expect(() => resumeRun(flowV2, saved, {})).toThrow('flow.version: expected 2, got 1')
    expect(() => resumeRun(flowV2, saved, { migrate: (snap) => snap })).toThrow(
      "snapshot is not compatible with flow 'approval@2': context: rejected by boundary (Invalid input: expected string, received undefined)",
    )
    // Same version: migrate is not called.
    let called = 0
    const same = resumeRun(flowV1, saved, {
      migrate: (snap) => {
        called += 1
        return snap
      },
    })
    expect(called).toBe(0)
    same.dispose()
    // Async migration through resumeRunAsync.
    const asyncResumed = await resumeRunAsync(flowV2, saved, {
      migrate: async (snapshot) => {
        const snap = snapshot as {
          flow: object
          state: {
            context: object
          }
        }
        return {
          ...snap,
          flow: { name: 'approval', version: 2 },
          state: {
            ...snap.state,
            flow: { name: 'approval', version: 2 },
            context: { ...snap.state.context, currency: 'USD' },
          },
        }
      },
    })
    expect(asyncResumed.getState().context).toEqual({ amount: 5, currency: 'USD' })
    asyncResumed.dispose()
  })
  it('sync door: a migrate returning a REJECTED promise is refused without an unhandled rejection; a hostile `then` accessor is a SNAPSHOT_INCOMPATIBLE reason, not an escaping exception', async () => {
    const store = createMemoryStore()
    const old = createRun(flowV1, { context: { amount: 5 }, store, key: 'k' })
    await old.start()
    await old.save()
    old.dispose()
    const saved = await store.get('k')
    // Core compiles without node types: reach the process through globalThis for the listener.
    const proc = (
      globalThis as {
        process?: NodeLikeProcess
      }
    ).process
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    proc?.on('unhandledRejection', onUnhandled)
    try {
      const rejected = () =>
        resumeRun(flowV2, saved, { migrate: () => Promise.reject(new Error('later')) })
      expect(rejected).toThrow(/returned a promise .* \(use resumeAsync\)/)
      await tick()
      await tick()
      expect(unhandled).toEqual([])
    } finally {
      proc?.off('unhandledRejection', onUnhandled)
    }
    const hostile = () =>
      resumeRun(flowV2, saved, {
        migrate: () => ({
          // biome-ignore lint/suspicious/noThenProperty: intentionally hostile thenable
          get then(): never {
            throw new Error('no then for you')
          },
        }),
      })
    expect(hostile).toThrow(/migrate: threw \(no then for you\)/)
    let code: string | undefined
    try {
      hostile()
    } catch (error) {
      code = (
        error as {
          code?: string
        }
      ).code
    }
    expect(code).toBe('SNAPSHOT_INCOMPATIBLE')
  })
})
describe('resume: shared references and definition drift', () => {
  it('resumes a live snapshot whose context and output share one object', async () => {
    const signup = defineWizard(
      {
        name: 'signup',
        context: z.object({ profile: z.object({ id: z.string() }).optional() }),
        events: { verified: z.object({}) },
      },
      ({ steps, step }) =>
        steps({
          create: step({
            run: ({ update }) => {
              const profile = { id: 'p1' }
              update({ profile })
              return profile
            },
            next: 'wait',
          }),
          wait: step({ waitFor: { verified: () => undefined }, next: 'done' }),
          done: step({}),
        }),
    )
    const run = createRun(signup, { context: {} })
    await run.start()
    const resumed = resumeRun(signup, run.getSnapshot(), {})
    run.dispose()
    expect(resumed.getState().context).toEqual({ profile: { id: 'p1' } })
    expect(resumed.getState().current).toBe(null)
    expect(resumed.waitingFor()).toEqual([
      { kind: 'event', path: [], step: 'wait', events: ['verified'] },
    ])
    resumed.dispose()
  })
  it('an added step resumes idle; a renamed step resumes through renameSteps', async () => {
    const flowV1 = defineWizard(
      { name: 'drift', version: 1, context: z.object({}) },
      ({ steps, view, step }) =>
        steps({
          a: view({ next: 'b' }),
          b: view({ next: 'end' }),
          end: step({}),
        }),
    )
    const run = createRun(flowV1, { context: {} })
    await run.start()
    await run.next()
    const saved = JSON.parse(JSON.stringify(run.getSnapshot())) as unknown
    run.dispose()
    const withExtra = defineWizard(
      { name: 'drift', version: 1, context: z.object({}) },
      ({ steps, view, step }) =>
        steps({
          a: view({ next: 'b' }),
          b: view({ next: 'extra' }),
          extra: view({ next: 'end' }),
          end: step({}),
        }),
    )
    const grown = resumeRun(withExtra, saved, {})
    expect(grown.getState().steps.extra.status).toBe('idle')
    grown.dispose()
    const renamed = defineWizard(
      { name: 'drift', version: 2, context: z.object({}) },
      ({ steps, view, step }) =>
        steps({
          a: view({ next: 'review' }),
          review: view({ next: 'end' }),
          end: step({}),
        }),
    )
    const resumed = resumeRun(renamed, saved, {
      migrate: (snapshot) => renameSteps(snapshot, { b: 'review' }),
    })
    expect(resumed.getState().current).toBe('review')
    expect(await resumed.next()).toMatchObject({ ok: true, from: 'review' })
    expect(resumed.result()).toMatchObject({ status: 'done' })
    resumed.dispose()
  })
})
