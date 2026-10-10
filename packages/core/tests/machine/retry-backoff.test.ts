/**
 * Scheduler (§3 / §4.1) — retry / backoff / timeout and `final` steps.
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../src/machine/commands'
import { machine } from '../../src/machine/index'
import { createHarness, final, flow, of, task, view } from '../helpers/fixtures'

const machineDecide = (h: ReturnType<typeof createHarness>, msg: Message) =>
  machine.decide(h.env, h.state, msg)

describe('retry / backoff / timeout', () => {
  const retrying = (retry: {
    attempts: number
    backoff?: number | 'exponential'
    baseMs?: number
    factor?: number
    maxBackoffMs?: number
  }) =>
    flow({
      start: 't',
      steps: { t: task({ retry, next: 'end' }), end: final() },
    })

  it('exponential backoff: schedule attempts 2..N+1 at 200·2^(n-1) capped by maxBackoffMs, then fail', () => {
    const h = createHarness(retrying({ attempts: 3, backoff: 'exponential', maxBackoffMs: 500 }), {
      now: 10_000,
    })
    h.start()
    const delays: number[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      const call = h.call('run', 't')
      expect(call.token.attempt).toBe(attempt)
      const r = h.err(call, `fail ${attempt}`)
      expect(r.types).toEqual(['step.runFailed', 'step.retryScheduled'])
      const sched = of(r, 'step.retryScheduled')[0]!
      expect(sched.attempt).toBe(attempt + 1)
      delays.push(sched.dueAt - h.clock.now)
      expect(h.rec('t')).toMatchObject({ status: 'active', attempt, retryAt: sched.dueAt })
      expect(h.state.timers[sched.timerId]).toMatchObject({
        at: sched.dueAt,
        purpose: 'retry',
        step: 't',
      })
      expect(r.effects[0]).toMatchObject({ kind: 'timer.set', timerId: 'retry:t', at: sched.dueAt })
      // a stale duplicate result for the same attempt is ignored while waiting for the timer
      expect(h.err(call, 'dup').types).toEqual(['result.ignored'])
      h.clock.advance(delays[delays.length - 1]!)
      const fired = h.fire(sched.timerId)
      expect(fired.types).toEqual(['timer.fired', 'step.runStarted'])
      expect(of(fired, 'step.runStarted')[0]).toMatchObject({ attempt: attempt + 1, runId: 1 })
      expect(h.rec('t').retryAt).toBeUndefined()
      expect(h.state.timers).toEqual({})
    }
    expect(delays).toEqual([200, 400, 500])
    // attempt 4 fails for good
    const last = h.err(h.call('run', 't'), 'final failure')
    expect(last.types).toEqual(['step.runFailed', 'step.failed', 'flow.failed'])
    expect(of(last, 'step.runFailed')[0]?.willRetry).toBe(false)
    expect(h.rec('t')).toMatchObject({ status: 'failed', error: { kind: 'run', attempt: 4 } })
    expect(h.state.status).toBe('failed')
  })

  it('fixed and tuned exponential backoff (baseMs/factor); flow-level retry policy applies when the step has none', () => {
    const fixed = createHarness(retrying({ attempts: 1, backoff: 1234 }))
    fixed.start()
    expect(of(fixed.err(fixed.call('run')), 'step.retryScheduled')[0]?.dueAt).toBe(
      fixed.clock.now + 1234,
    )

    const tuned = createHarness(
      retrying({ attempts: 3, backoff: 'exponential', baseMs: 10, factor: 3, maxBackoffMs: 50 }),
    )
    tuned.start()
    const delays: number[] = []
    for (let i = 0; i < 3; i++) {
      delays.push(
        of(tuned.err(tuned.call('run')), 'step.retryScheduled')[0]!.dueAt - tuned.clock.now,
      )
      tuned.fire('retry:t')
    }
    expect(delays).toEqual([10, 30, 50])

    // purity: the same state + message always yields the same schedule (no callbacks in the policy)
    const pure = createHarness(retrying({ attempts: 1, backoff: 'exponential' }))
    pure.start()
    const call = pure.call('run')
    const msg = {
      type: 'res.err',
      effectId: call.effectId,
      hook: 'run',
      token: call.token,
      error: { name: 'E', message: 'x' },
      durationMs: 0,
    } as const
    const a = pure.env.def && machineDecide(pure, msg)
    const b2 = machineDecide(pure, msg)
    expect(a).toEqual(b2)

    const flowLevel = createHarness(
      flow({
        start: 't',
        steps: { t: task({ next: 'end' }), end: final() },
        policies: { retry: { attempts: 1, backoff: 5 } },
      }),
    )
    flowLevel.start()
    expect(flowLevel.err(flowLevel.call('run')).types).toEqual([
      'step.runFailed',
      'step.retryScheduled',
    ])
  })

  it('no retry policy: the first failure fails the step; timedOut → kind timeout; timeoutMs is planned on the run call', () => {
    const h = createHarness(
      flow({ start: 't', steps: { t: task({ timeoutMs: 50, next: 'end' }), end: final() } }),
    )
    h.start()
    const call = h.call('run')
    expect(call.timeoutMs).toBe(50)
    const r = h.err(call, 'timed out', { timedOut: true })
    expect(r.types).toEqual(['step.runFailed', 'step.failed', 'flow.failed'])
    expect(of(r, 'step.failed')[0]?.kind).toBe('timeout')
    expect(h.rec('t').error?.kind).toBe('timeout')
  })

  it('retry command re-runs a failed task with attempt 1 and the flow resumes; success clears failedStep', () => {
    const h = createHarness(flow({ start: 't', steps: { t: task({ next: 'end' }), end: final() } }))
    h.start()
    h.err(h.call('run'), 'nope')
    expect(h.state.status).toBe('failed')
    // most commands are rejected while halted, retry is not
    expect(of(h.cmd('next'), 'transition.rejected')[0]?.reason).toBe('flow-terminal')
    expect(of(h.cmd({ type: 'send', event: 'x', payload: 1 }), 'command.rejected')[0]?.code).toBe(
      'FLOW_TERMINAL',
    )
    expect(of(h.cmd({ type: 'retry', step: 'end' }), 'command.rejected')[0]?.code).toBe(
      'NOT_A_TASK',
    )
    const r = h.cmd({ type: 'retry', step: 't' })
    expect(r.types).toEqual(['step.runStarted'])
    expect(of(r, 'step.runStarted')[0]).toMatchObject({ attempt: 1, runId: 1 })
    expect(h.state.status).toBe('running')
    expect(h.rec('t').error).toBeUndefined()
    expect(of(h.cmd({ type: 'retry', step: 't' }), 'command.rejected')[0]?.reason).toBe(
      'not-failed',
    )
    h.ok(h.call('run'), 'ok')
    expect(h.state.status).toBe('done')
  })

  it('halt: other running tasks settle but nothing new enters until the failed step recovers', () => {
    const h = createHarness(
      flow({
        start: ['a', 'b'],
        steps: {
          a: task({ next: 'c' }),
          b: task({ next: 'c' }),
          c: task({ dependsOn: ['a', 'b'], next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.err(h.call('run', 'a'), 'boom')
    expect(h.state.status).toBe('failed')
    // b still settles: its result is applied, its successor is arrived, nothing enters
    const r = h.ok(h.call('run', 'b'), 'fine')
    expect(r.types).toContain('step.done')
    expect(h.rec('b').status).toBe('done')
    expect(h.rec('c')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(h.state.status).toBe('failed')
    // retry a → the flow resumes; when a completes, c (arrived, deps met) enters
    h.cmd({ type: 'retry', step: 'a' })
    expect(h.state.status).toBe('running')
    h.ok(h.call('run', 'a'), 'ok')
    expect(h.rec('c').status).toBe('active')
    h.ok(h.call('run', 'c'), 'ok')
    expect(h.state.status).toBe('done')
  })
})

describe('final', () => {
  it('reaching a final cancels every other active step (running tasks, waiting views) before flow.done', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['slow', 'v', 'end'] }),
          slow: task(),
          v: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next') // slow runs, v is current, end is arrived but ends the flow → cancels
    // NB: `end` is arrived by the fan-out too, so the flow finishes in this very batch:
    const r = h.log.filter((e) => e.seq > 4)
    const cancelled = of(r, 'step.cancelled')
    expect(cancelled.map((c) => c.step).sort()).toEqual(['slow', 'v'])
    expect(cancelled[0]?.reason).toBe('flow-done')
    expect(r.slice(-2).map((e) => e.type)).toEqual(['step.done', 'flow.done'])
    expect(h.state.status).toBe('done')
    expect(h.state.active).toEqual([])
    expect(h.state.current).toBeNull()
    // slow was cancelled before its run was ever planned (same batch) → no pending run call
    expect(h.pending('run', 'slow')).toHaveLength(0)
  })

  it('a late run result for a task cancelled by flow-done is ignored as cancelled', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['slow', 'v'] }),
          slow: task(),
          v: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const run = h.call('run', 'slow')
    const r = h.cmd('next')
    expect(of(r, 'step.cancelled').map((c) => c.step)).toEqual(['slow'])
    expect(h.state.status).toBe('done')
    expect(h.ok(run, 'late').types).toEqual(['result.ignored'])
    expect(of(h.log, 'result.ignored')[0]?.reason).toBe('cancelled')
  })

  it('finalOutput hook: called after enter; its value becomes step output and flow output', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ next: 'end' }),
          end: final({ output: () => ({ total: 1 }) }),
        },
      }),
    )
    h.start()
    h.ok(h.call('run'), 42)
    expect(h.state.status).toBe('running')
    const fo = h.call('finalOutput')
    expect(fo.token).toEqual({ step: 'end', runId: 1 })
    const r = h.ok(fo, { total: 1 })
    expect(r.types).toEqual(['step.done', 'flow.done'])
    expect(h.state.output).toEqual({ total: 1 })
    expect(h.rec('end').output).toEqual({ total: 1 })
    expect(r.effects.at(-1)).toEqual({ kind: 'persist', reason: 'final' })
  })
})
