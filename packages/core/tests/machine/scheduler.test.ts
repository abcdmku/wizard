import { describe, expect, it } from 'vitest'
import type { Message } from '../../src/machine/commands'
import { explain, machine } from '../../src/machine/index'
import { createHarness, final, flow, of, task, view } from '../helpers/fixtures'

const machineDecide = (h: ReturnType<typeof createHarness>, msg: Message) =>
  machine.decide(h.env, h.state, msg)

describe('scheduler — arrival, gating, ordering', () => {
  it('start with several entry steps arrives at each; ready tasks enter in arrival order and run in parallel', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'join' }),
          t2: task({ next: 'join' }),
          join: task({ dependsOn: ['t1', 't2'], next: 'end' }),
          end: final(),
        },
      }),
    )
    const r = h.start()
    expect(r.types).toEqual([
      'flow.started',
      'step.arrived',
      'step.arrived',
      'step.entered',
      'step.runStarted',
      'step.entered',
      'step.runStarted',
    ])
    expect(h.state.active).toEqual(['t1', 't2'])
    expect(h.state.status).toBe('running')
    const runs = h.pending('run')
    expect(runs.map((c) => c.step)).toEqual(['t1', 't2'])
    expect(runs[0]?.token).toEqual({ step: 't1', runId: 1, attempt: 1 })
    expect(of(r, 'step.runStarted')[0]).toMatchObject({
      idempotencyKey: 'inst-1:t1:1',
      attempt: 1,
      runId: 1,
    })
  })

  it('dependsOn (all): the join is arrived by the first completion but only enters when every dep is done', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'join' }),
          t2: task({ next: 'join' }),
          join: task({ dependsOn: ['t1', 't2'], next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const first = h.ok(h.call('run', 't1'), 'a')
    expect(of(first, 'step.arrived').map((e) => e.step)).toEqual(['join'])
    expect(h.rec('join')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(explain(h.def, h.state, 'join').reasons).toEqual(['deps-unmet:t2'])
    const second = h.ok(h.call('run', 't2'), 'b')
    expect(second.types).toContain('step.entered')
    expect(h.rec('join').status).toBe('active')
    expect(h.pending('run', 'join')).toHaveLength(1)
  })

  it('dependsOn (any): the join enters as soon as one dep is done', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'join' }),
          t2: task({ next: 'join' }),
          join: task({ dependsOn: { any: ['t1', 't2'] }, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 't2'), 'b')
    expect(h.rec('join').status).toBe('active')
  })

  it('a step with dependsOn but no arrival never activates when its deps complete (activation only by arrival)', () => {
    const h = createHarness(
      flow({
        start: 't1',
        steps: {
          t1: task({ next: 'end' }),
          orphan: task({ dependsOn: ['t1'] }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 't1'), 1)
    expect(h.state.status).toBe('done')
    expect(h.rec('orphan')).toMatchObject({ status: 'idle', pendingActivation: false })
    expect(explain(h.def, h.state, 'orphan').reasons).toContain('not-activated')
  })

  it('concurrency budget: extra ready tasks stay pending and are picked in arrivedSeq order when a slot frees', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2', 't3'],
        steps: {
          t1: task({ next: 'end' }),
          t2: task({ next: 'end' }),
          t3: task({ next: 'end' }),
          end: final({ dependsOn: ['t1', 't2', 't3'] }),
        },
        policies: { concurrency: 2 },
      }),
    )
    h.start()
    expect(h.state.active).toEqual(['t1', 't2'])
    expect(h.rec('t3')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(explain(h.def, h.state, 't3').reasons).toEqual(['concurrency-limit'])
    // finish t2 → t3 enters (only one slot freed)
    const r = h.ok(h.call('run', 't2'), 'x')
    expect(of(r, 'step.entered').map((e) => e.step)).toEqual(['t3'])
    expect(h.state.active).toEqual(['t1', 't3'])
    h.ok(h.call('run', 't1'), 'x')
    h.ok(h.call('run', 't3'), 'x')
    expect(h.state.status).toBe('done')
  })

  it('autoRun manual: ready tasks wait for runReady (all) or run{step} (one, ignoring the budget)', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2', 't3'],
        steps: {
          t1: task({ next: 'end' }),
          t2: task({ next: 'end' }),
          t3: task({ next: 'end' }),
          end: final({ dependsOn: ['t1', 't2', 't3'] }),
        },
        policies: { autoRun: 'manual', concurrency: 1 },
      }),
    )
    h.start()
    expect(h.state.active).toEqual([])
    expect(h.state.status).toBe('waiting')
    expect(explain(h.def, h.state, 't1').reasons).toEqual(['auto-run-manual'])
    // run a specific one, ignoring the budget
    h.cmd({ type: 'run', step: 't2' })
    h.cmd({ type: 'run', step: 't3' })
    expect(h.state.active).toEqual(['t2', 't3'])
    // runReady respects the budget (1) → t1 stays pending
    expect(h.cmd('runReady').types).toEqual([])
    h.ok(h.call('run', 't2'), 1)
    h.ok(h.call('run', 't3'), 1)
    expect(h.state.active).toEqual([])
    h.cmd('runReady')
    expect(h.state.active).toEqual(['t1'])
    // run rejections
    expect(of(h.cmd({ type: 'run', step: 't1' }), 'command.rejected')[0]?.code).toBe('NOT_ACTIVE')
    expect(of(h.cmd({ type: 'run', step: 'end' }), 'command.rejected')[0]?.code).toBe('NOT_A_TASK')
    expect(of(h.cmd({ type: 'run', step: 'nope' }), 'command.rejected')[0]?.code).toBe(
      'UNKNOWN_STEP',
    )
  })

  it('a task with an enter hook starts its run only after enter resolves; enter failure fails the step', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    const r = h.start()
    expect(r.types).toEqual(['flow.started', 'step.arrived', 'step.entered'])
    expect(of(r, 'step.entered')[0]?.enterPending).toBe(true)
    expect(h.rec('t').entering).toBe(true)
    expect(h.pending('run')).toHaveLength(0)
    const enter = h.call('enter')
    expect(enter.token).toEqual({ step: 't', runId: 1 })
    const done = h.ok(enter)
    expect(done.types).toEqual(['step.enterCompleted', 'step.runStarted'])
    expect(h.rec('t').entering).toBeUndefined()
    expect(h.pending('run')).toHaveLength(1)
  })

  it('enter hook error on a scheduler entry → step.failed{kind:hook} + failure policy', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: task({ enter: () => undefined, next: 'end' }), end: final() },
      }),
    )
    h.start()
    const r = h.err(h.call('enter'), 'no entry')
    expect(r.types).toEqual(['step.failed', 'flow.failed'])
    expect(h.rec('t').error).toMatchObject({ kind: 'hook', message: 'no entry' })
    expect(h.state.status).toBe('failed')
  })
})

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
