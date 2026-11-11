/**
 * (g) dispose() settles pending promises with DISPOSED and (h) strict:'sync'
 * violations keep their SYNC_VIOLATION code end-to-end — with the REAL machine.
 * Plus: persistence through the run with the real machine (autoSave + resume
 * from the store).
 */

import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../../src/persistence/memory-store'
import type { Snapshot } from '../../../src/wizard/snapshot'
import { flow, routingStep, runStep, view } from '../../helpers/fixtures'
import { e2e, e2eResume, tick } from './harness'

describe('e2e dispose', () => {
  it('settles a pending navigation and a pending async run with DISPOSED; timers and signals are cleared', async () => {
    let signal: AbortSignal | undefined
    const def = flow({
      name: 'dispose',
      start: 'a',
      steps: {
        a: view({ exit: () => new Promise<void>(() => {}), next: 't' }),
        t: runStep({
          run: ({ signal: s }) => {
            signal = s
            return new Promise(() => {})
          },
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    const pending = t.run.next()
    expect(t.run.getState().nav.phase).toBe('exiting')
    t.run.dispose()
    const disposedNav = {
      ok: false,
      reason: 'failed',
      code: 'DISPOSED',
      message: 'the run is disposed; create or resume a new run',
    }
    expect(await pending).toEqual(disposedNav)
    expect(await t.run.next()).toEqual(disposedNav)

    // A running task at dispose time: aborted, silenced.
    const u = e2e(
      flow({
        name: 'run',
        start: 't',
        steps: {
          t: runStep({
            run: ({ signal: s }) => {
              signal = s
              return new Promise(() => {})
            },
          }),
        },
      }),
    )
    await u.run.start()
    expect(signal?.aborted).toBe(false)
    u.run.dispose()
    expect(signal?.aborted).toBe(true)
    expect(u.sched.pending()).toBe(0)
  })
})

describe("e2e strict: 'sync'", () => {
  it('a thenable from a step run fails the step with code SYNC_VIOLATION preserved on the error', async () => {
    const def = flow({
      name: 'strict-task',
      start: 't',
      steps: { t: runStep({ run: async () => 1, next: 'end' }), end: routingStep() },
    })
    const t = e2e(def, { strict: 'sync' })
    await t.run.start()
    expect(t.rec('t')).toMatchObject({ status: 'failed', error: { code: 'SYNC_VIOLATION' } })
    expect(t.of('step.runFailed')[0]).toMatchObject({
      willRetry: false,
      error: { code: 'SYNC_VIOLATION' },
    })
    expect(t.run.getState().status).toBe('halted')
  })

  it("a strict-sync violation is step.failed{kind:'sync-violation'} and is never retried, even with a retry policy", async () => {
    const def = flow({
      name: 'strict-retry',
      start: 't',
      steps: {
        t: runStep({ run: async () => 1, retry: { retries: 2, backoff: 10 }, next: 'end' }),
        end: routingStep(),
      },
    })
    const t = e2e(def, { strict: 'sync' })
    await t.run.start()
    expect(t.of('step.runFailed')).toHaveLength(1)
    expect(t.of('step.runFailed')[0]).toMatchObject({
      willRetry: false,
      error: { code: 'SYNC_VIOLATION' },
    })
    expect(t.of('step.retryScheduled')).toEqual([])
    expect(t.of('step.failed')[0]).toMatchObject({
      step: 't',
      kind: 'sync-violation',
      error: { code: 'SYNC_VIOLATION' },
    })
    expect(t.rec('t')).toMatchObject({
      status: 'failed',
      error: { kind: 'sync-violation', code: 'SYNC_VIOLATION' },
    })
    expect(t.run.getState().status).toBe('halted')
    expect(t.sched.pending()).toBe(0)
    t.sched.advance(1_000)
    expect(t.of('step.runStarted')).toHaveLength(1)
  })

  it('a thenable from a transition hook (exit) fails the transaction: NavResult/CommandResult carry SYNC_VIOLATION', async () => {
    const def = flow({
      name: 'strict-nav',
      start: 'a',
      steps: { a: view({ exit: async () => undefined, next: 'b' }), b: view() },
    })
    const t = e2e(def, { strict: 'sync' })
    await t.run.start()
    const nav = await t.run.next()
    expect(nav).toMatchObject({
      ok: false,
      reason: 'failed',
      code: 'SYNC_VIOLATION',
      step: 'a',
      error: { code: 'SYNC_VIOLATION' },
    })
    expect(t.of('transition.failed')[0]).toMatchObject({
      step: 'a',
      error: { code: 'SYNC_VIOLATION' },
    })
    expect(t.run.getState().current).toBe('a')
    expect(t.run.getState().nav.phase).toBe('idle')
    expect(await t.run.dispatch({ type: 'next' })).toMatchObject({
      ok: false,
      code: 'SYNC_VIOLATION',
      step: 'a',
    })
  })
})

describe('e2e persistence with the real machine', () => {
  it('auto-saves after each drain, and a fresh runtime resumes from the store', async () => {
    const store = createMemoryStore()
    const def = flow({
      name: 'persist',
      start: 'a',
      steps: {
        a: view({ next: 't' }),
        t: runStep({ run: async () => 'done', next: 'end' }),
        end: routingStep(),
      },
    })
    const t = e2e(def, { store, key: 'k' })
    await t.run.start()
    await tick()
    const saved = (await store.get('k')) as Snapshot
    expect(saved).toMatchObject({
      v: 1,
      flow: { name: 'persist', version: 1 },
      seq: t.run.getState().seq,
    })
    const nav = t.run.next()
    // Synchronously after next(): the async task is running — this is the "crash mid-run" snapshot
    // (the store receives it too, followed by the done snapshot once the run settles).
    const running = JSON.parse(JSON.stringify(t.run.getSnapshot())) as Snapshot
    expect(running.state.steps.t?.status).toBe('active')
    await nav
    await tick()
    await new Promise((r) => setTimeout(r, 0))
    expect(t.run.getState().status).toBe('done')
    expect(((await store.get('k')) as Snapshot).state.status).toBe('done')
    t.run.dispose()

    // Resume the "crashed mid-run" snapshot: interrupted → retry → done, still persisting.
    const b = e2eResume(def, running, { store, key: 'k' })
    expect(b.run.epoch).toBe(1)
    expect(b.rec('t')).toMatchObject({ status: 'failed', error: { kind: 'interrupted' } })
    await b.run.retry('t')
    await tick()
    expect(b.run.getState().status).toBe('done')
    await b.run.save()
    const final2 = (await store.get('k')) as Snapshot
    expect(final2).toMatchObject({ epoch: 1, state: { status: 'done' } })
  })
})

describe('e2e progress', () => {
  it('progress(value) reaches observe() but never the log, the state or the snapshot', async () => {
    const def = flow({
      name: 'progress',
      start: 't',
      steps: {
        t: runStep({
          run: ({ progress }) => {
            progress({ done: 1, total: 2 })
            return 'ok'
          },
          next: 'end',
        }),
        end: routingStep(),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.of('step.progress')).toMatchObject([
      { type: 'step.progress', step: 't', value: { done: 1, total: 2 }, path: [] },
    ])
    expect(t.run.log().some((event) => event.type === 'step.progress')).toBe(false)
    expect(JSON.stringify(t.run.getSnapshot())).not.toContain('"total":2')
  })
})
