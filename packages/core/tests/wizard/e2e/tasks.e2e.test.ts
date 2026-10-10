/**
 * (b) tasks with the REAL machine: async run, retry { attempts: 3, backoff: 100 }
 * succeeding on attempt 2 (scheduler-driven, `step.retryScheduled.dueAt`),
 * timeout → failed → `retry(step)` re-runs; output boundary rejection.
 */

import { describe, expect, it } from 'vitest'
import { final, flow, guard, task } from '../../helpers/fixtures'
import { e2e, tick } from './harness'

describe('e2e tasks: retry, timeout, retry command', () => {
  it('retries an async task on a fixed backoff and succeeds on attempt 2', async () => {
    let calls = 0
    const def = flow({
      name: 'retry',
      start: 't',
      steps: {
        t: task({
          run: async ({ attempt }) => {
            calls += 1
            if (attempt === 1) throw new Error('flaky')
            return { attempt }
          },
          retry: { attempts: 3, backoff: 100 },
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def, { now: 50_000 })
    await t.wizard.start()
    expect(t.rec('t')).toMatchObject({ status: 'active', attempt: 1, runId: 1 })
    await tick()
    // Attempt 1 failed → retry scheduled at now + 100.
    expect(t.of('step.runFailed')[0]).toMatchObject({
      attempt: 1,
      willRetry: true,
      error: { message: 'flaky' },
    })
    const scheduled = t.of('step.retryScheduled')[0]
    expect(scheduled).toMatchObject({ step: 't', attempt: 2, dueAt: 50_100, timerId: 'retry:t' })
    expect(t.rec('t').retryAt).toBe(50_100)
    expect(t.wizard.getState().timers['retry:t']).toMatchObject({
      at: 50_100,
      purpose: 'retry',
      step: 't',
    })
    expect(t.sched.pending()).toBe(1)
    t.sched.advance(99)
    expect(calls).toBe(1)
    t.sched.advance(1)
    expect(calls).toBe(2)
    expect(t.rec('t').attempt).toBe(2)
    expect(t.rec('t').retryAt).toBeUndefined()
    await tick()
    expect(t.rec('t')).toMatchObject({ status: 'done', output: { attempt: 2 } })
    expect(t.wizard.getState().status).toBe('done')
    expect(t.of('step.runSucceeded')[0]).toMatchObject({ attempt: 2 })
    expect(t.of('timer.fired')).toHaveLength(1)
  })

  it('exhausts retries → step.failed{kind:run} → flow failed (halt); retry(step) re-runs and recovers', async () => {
    let fail = true
    const def = flow({
      name: 'halt',
      start: 't',
      steps: {
        t: task({
          run: async () => {
            if (fail) throw new Error('down')
            return 'up'
          },
          retry: { attempts: 1, backoff: 10 },
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    await tick()
    t.sched.advance(10)
    await tick()
    expect(t.of('step.runFailed').map((e) => [e.attempt, e.willRetry])).toEqual([
      [1, true],
      [2, false],
    ])
    expect(t.rec('t')).toMatchObject({ status: 'failed', error: { kind: 'run', message: 'down' } })
    expect(t.wizard.getState().status).toBe('failed')
    expect(t.types()).toContain('flow.failed')
    // Recoverable halt-failure: only retry/cancel/compensate are accepted.
    expect(await t.wizard.next()).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    fail = false
    const retried = t.wizard.retry('t')
    // The retry command commits synchronously (runStarted); the async run lands later.
    expect(t.rec('t')).toMatchObject({ status: 'active', attempt: 1 })
    expect(await retried).toMatchObject({ ok: true })
    await tick()
    expect(t.rec('t')).toMatchObject({ status: 'done', output: 'up' })
    expect(t.wizard.getState().status).toBe('done')
    expect(await t.wizard.retry('t')).toMatchObject({ ok: false })
  })

  it('a timeout aborts the run (signal), fails with kind:timeout after the retries, and retry() works', async () => {
    const signals: AbortSignal[] = []
    let hang = true
    const def = flow({
      name: 'timeout',
      start: 't',
      steps: {
        t: task({
          run: ({ signal }) => {
            signals.push(signal)
            return hang ? new Promise(() => {}) : Promise.resolve('fast')
          },
          timeoutMs: 500,
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    t.sched.advance(499)
    expect(t.rec('t').status).toBe('active')
    t.sched.advance(1)
    expect(signals[0]?.aborted).toBe(true)
    expect(t.of('step.runFailed')[0]).toMatchObject({
      attempt: 1,
      willRetry: false,
      timedOut: true,
    })
    expect(t.rec('t')).toMatchObject({ status: 'failed', error: { kind: 'timeout' } })
    expect(t.wizard.getState().status).toBe('failed')
    hang = false
    expect(await t.wizard.retry('t')).toMatchObject({ ok: true })
    await tick()
    expect(t.rec('t')).toMatchObject({ status: 'done', output: 'fast' })
    expect(signals).toHaveLength(2)
    expect(t.wizard.getState().status).toBe('done')
  })

  it('an output boundary rejects the run value → the task fails with the boundary issues', async () => {
    const def = flow({
      name: 'output',
      start: 't',
      steps: {
        t: task({
          run: () => ({ id: 42 }),
          output: guard((v) => typeof (v as any)?.id === 'string', 'id must be a string'),
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    expect(t.rec('t')).toMatchObject({
      status: 'failed',
      error: { kind: 'run', name: 'BoundaryRejection' },
    })
    expect(t.of('step.runFailed')[0]?.error.message).toContain('id must be a string')
    expect(t.wizard.getState().status).toBe('failed')
  })
})
