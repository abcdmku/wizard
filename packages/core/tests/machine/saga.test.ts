import { describe, expect, it } from 'vitest'
import { createHarness, final, flow, flowStep, of, task, view } from '../helpers/fixtures'

const comp = () => undefined

/** t1 → t2 → t3 (all compensable) → boom (fails) ; onFailure compensate. */
const saga = (opts: { boomRetry?: number } = {}) =>
  flow({
    start: 't1',
    steps: {
      t1: task({ compensate: comp, next: 't2' }),
      t2: task({ compensate: comp, next: 't3' }),
      t3: task({ compensate: comp, next: 'boom' }),
      boom: task({
        next: 'end',
        ...(opts.boomRetry !== undefined ? { retry: { attempts: opts.boomRetry } } : {}),
      }),
      end: final(),
    },
    policies: { onFailure: 'compensate' },
  })

function runThree(h: ReturnType<typeof createHarness>) {
  h.start()
  h.ok(h.call('run', 't1'), 'r1')
  h.ok(h.call('run', 't2'), 'r2')
  h.ok(h.call('run', 't3'), 'r3')
}

describe('compensation', () => {
  it('step.done pushes compensable steps on saga.stack in completion order (one entry per step)', () => {
    const h = createHarness(saga())
    runThree(h)
    expect(h.state.saga.stack.map((e) => e.step)).toEqual(['t1', 't2', 't3'])
    const seqs = h.state.saga.stack.map((e) => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    expect(h.state.saga.stack[0]?.seq).toBe(
      of(h.log, 'step.done').find((e) => e.step === 't1')?.seq,
    )
  })

  it('a task failure with onFailure:compensate unwinds in reverse order, one step at a time, then flow.compensated{failed}', () => {
    const h = createHarness(saga())
    runThree(h)
    const r = h.err(h.call('run', 'boom'), 'kaput')
    expect(r.types).toEqual([
      'step.runFailed',
      'step.failed',
      'flow.compensating',
      'step.compensationStarted',
    ])
    expect(of(r, 'flow.compensating')[0]).toMatchObject({
      plan: ['t3', 't2', 't1'],
      outcome: 'failed',
      reason: 'step-failed:boom',
    })
    expect(h.state.status).toBe('compensating')
    expect(h.state.saga.outcome).toBe('failed')
    expect(h.rec('t3').status).toBe('compensating')
    // exactly one compensate call in flight, with the step's output and the reason
    const c3 = h.call('compensate')
    expect(c3).toMatchObject({
      step: 't3',
      extra: { output: 'r3', reason: 'step-failed:boom' },
      token: { step: 't3', runId: 1 },
    })
    expect(h.pending('compensate')).toHaveLength(1)
    // commands are rejected while compensating
    expect(of(h.cmd('next'), 'transition.rejected')[0]?.reason).toBe('flow-compensating')
    expect(of(h.cmd({ type: 'send', event: 'x', payload: {} }), 'command.rejected')[0]?.code).toBe(
      'FLOW_COMPENSATING',
    )
    expect(of(h.cmd({ type: 'retry', step: 'boom' }), 'command.rejected')[0]?.code).toBe(
      'FLOW_COMPENSATING',
    )
    expect(h.cmd('cancel').types).toEqual([]) // no-op

    const order: string[] = []
    let batch = h.ok(c3)
    order.push('t3')
    expect(batch.types).toEqual(['step.compensated', 'step.compensationStarted'])
    batch = h.ok(h.call('compensate'))
    order.push(h.rec('t2').status === 'compensated' ? 't2' : '?')
    expect(batch.types).toEqual(['step.compensated', 'step.compensationStarted'])
    const last = h.ok(h.call('compensate'))
    order.push('t1')
    expect(last.types).toEqual(['step.compensated', 'flow.compensated'])
    expect(order).toEqual(['t3', 't2', 't1'])
    expect(of(last, 'flow.compensated')[0]).toEqual(
      expect.objectContaining({ failures: [], outcome: 'failed' }),
    )
    expect(h.state.status).toBe('failed')
    expect(h.state.saga.compensated).toEqual([
      { step: 't3', runId: 1 },
      { step: 't2', runId: 1 },
      { step: 't1', runId: 1 },
    ])
    expect(h.state.active).toEqual([])
    expect(last.effects.at(-1)).toEqual({ kind: 'persist', reason: 'final' })
    // terminal: even retry is rejected now
    expect(of(h.cmd({ type: 'retry', step: 'boom' }), 'command.rejected')[0]?.code).toBe(
      'FLOW_TERMINAL',
    )
  })

  it('partial failure: a failing compensate is recorded in saga.failures and the unwind continues; compensate({from}) re-runs it', () => {
    const h = createHarness(saga())
    runThree(h)
    h.err(h.call('run', 'boom'), 'kaput')
    h.ok(h.call('compensate')) // t3 ok
    const failed = h.err(h.call('compensate'), 'release failed') // t2 fails
    expect(failed.types).toEqual(['step.compensationFailed', 'step.compensationStarted'])
    expect(h.rec('t2')).toMatchObject({
      status: 'failed',
      error: { kind: 'compensate', message: 'release failed' },
    })
    expect(h.state.saga.failures).toEqual([{ step: 't2', runId: 1 }])
    const done = h.ok(h.call('compensate')) // t1 ok
    expect(of(done, 'flow.compensated')[0]).toMatchObject({ failures: ['t2'], outcome: 'failed' })
    expect(h.state.status).toBe('failed')

    // compensate({from: 't3'}) → not a failure
    expect(of(h.cmd({ type: 'compensate', from: 't3' }), 'command.rejected')[0]?.reason).toBe(
      'not-a-failure',
    )
    // compensate({from: 't2'}) re-runs only t2
    const again = h.cmd({ type: 'compensate', from: 't2' })
    expect(again.types).toEqual(['flow.compensating', 'step.compensationStarted'])
    expect(of(again, 'flow.compensating')[0]).toMatchObject({ plan: ['t2'], outcome: 'failed' })
    expect(h.state.status).toBe('compensating')
    expect(h.state.saga.failures).toEqual([])
    const fin = h.ok(h.call('compensate', 't2'))
    expect(fin.types).toEqual(['step.compensated', 'flow.compensated'])
    expect(of(fin, 'flow.compensated')[0]).toMatchObject({ failures: [], outcome: 'failed' })
    expect(h.state.saga.compensated).toEqual([
      { step: 't3', runId: 1 },
      { step: 't1', runId: 1 },
      { step: 't2', runId: 1 },
    ])
    // nothing left to compensate → compensate is rejected as terminal
    expect(of(h.cmd({ type: 'compensate' }), 'command.rejected')[0]?.code).toBe('FLOW_TERMINAL')
  })

  it('settle phase: running tasks are cancelled and the unwind waits for their in-flight results', () => {
    const h = createHarness(
      flow({
        start: ['a', 'b'],
        steps: {
          a: task({ compensate: comp, next: 'end' }),
          b: task({ compensate: comp, next: 'end' }),
          c: task({ next: 'end' }),
          end: final({ dependsOn: ['a', 'b'] }),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('run', 'a'), 'A') // a done (on the stack); b still running
    // make c fail: run it via cancel? no — fail b's sibling: use `cancel` instead to trigger compensation
    const runB = h.call('run', 'b')
    const r = h.cmd({ type: 'cancel', reason: 'user' })
    // phase 1: settling → a persisted grace timer bounds the wait for aborted runs
    expect(r.types).toEqual(['flow.compensating', 'step.cancelled', 'timer.scheduled'])
    expect(of(r, 'flow.compensating')[0]).toMatchObject({ outcome: 'cancelled', plan: ['a'] })
    expect(of(r, 'step.cancelled')[0]).toMatchObject({ step: 'b', reason: 'user' })
    expect(of(r, 'timer.scheduled')[0]).toMatchObject({
      timerId: 'saga:grace',
      purpose: 'compensationGrace',
      dueAt: h.clock.now + 30_000,
    })
    expect(r.effects.map((e) => e.kind)).toEqual(['timer.set', 'persist'])
    expect(h.state.saga.settling).toEqual(['b'])
    expect(h.state.status).toBe('compensating')
    // no compensate call yet: b's run is still in flight
    expect(h.pending('compensate')).toHaveLength(0)
    // b's late success is recorded and pushed on the stack; the grace timer is cleared and the
    // unwind starts (b first: highest seq)
    const late = h.ok(runB, 'B')
    expect(late.types).toEqual([
      'step.runSucceeded',
      'step.done',
      'timer.cleared',
      'step.compensationStarted',
    ])
    expect(h.state.timers).toEqual({})
    expect(h.state.saga.settling).toEqual([])
    expect(h.state.saga.stack.map((e) => e.step)).toEqual(['a', 'b'])
    expect(h.call('compensate').step).toBe('b')
    h.ok(h.call('compensate'))
    expect(h.call('compensate').step).toBe('a')
    const fin = h.ok(h.call('compensate'))
    expect(of(fin, 'flow.compensated')[0]).toMatchObject({ outcome: 'cancelled' })
    expect(h.state.status).toBe('cancelled')
  })

  it('settle phase: a late failure of a cancelled run also settles (nothing pushed)', () => {
    const h = createHarness(saga())
    h.start()
    h.ok(h.call('run', 't1'), 'r1')
    const runT2 = h.call('run', 't2')
    h.cmd('cancel')
    expect(h.state.saga.settling).toEqual(['t2'])
    const late = h.err(runT2, 'aborted')
    expect(late.types).toEqual(['step.runFailed', 'timer.cleared', 'step.compensationStarted'])
    expect(h.state.saga.stack.map((e) => e.step)).toEqual(['t1'])
    expect(h.rec('t2').status).toBe('cancelled')
  })

  it('cancel without compensable work → step.cancelled for actives + flow.cancelled', () => {
    const h = createHarness(saga())
    h.start()
    const r = h.cmd({ type: 'cancel', reason: 'bye' })
    expect(r.types).toEqual(['step.cancelled', 'flow.cancelled'])
    expect(of(r, 'flow.cancelled')[0]?.reason).toBe('bye')
    expect(h.state.status).toBe('cancelled')
    expect(of(h.cmd('cancel'), 'command.rejected')[0]?.code).toBe('FLOW_TERMINAL')
  })

  it('cancel on a halt flow cancels running tasks (timers cleared) and ends the flow', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: task({ retry: { attempts: 2, backoff: 100 }, next: 'end' }), end: final() },
      }),
    )
    h.start()
    h.err(h.call('run'), 'x') // retry timer armed
    expect(Object.keys(h.state.timers)).toEqual(['retry:t'])
    const r = h.cmd('cancel')
    expect(r.types).toEqual(['timer.cleared', 'step.cancelled', 'flow.cancelled'])
    expect(r.effects.map((e) => e.kind)).toEqual(['timer.clear', 'persist'])
    expect(h.state.timers).toEqual({})
    expect(h.rec('t').status).toBe('cancelled')
    expect(h.rec('t').retryAt).toBeUndefined()
  })

  it('compensate command on a running compensate-flow behaves like cancel (outcome cancelled)', () => {
    const h = createHarness(saga())
    runThree(h)
    const r = h.cmd({ type: 'compensate', reason: 'operator' })
    expect(of(r, 'flow.compensating')[0]).toMatchObject({
      outcome: 'cancelled',
      reason: 'operator',
      plan: ['t3', 't2', 't1'],
    })
    expect(of(r, 'step.cancelled').map((c) => c.step)).toEqual(['boom'])
  })

  it('a flow step on the stack is compensated through the child (child.send compensate → res.child terminal)', () => {
    const child = flow({ name: 'child', start: 'x', steps: { x: final() } })
    const h = createHarness(
      flow({
        start: 'sub',
        steps: {
          sub: flowStep(child, { compensate: comp, next: 'boom' }),
          boom: task({ next: 'end' }),
          end: final(),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('childContext'), { seed: 1 })
    h.child('sub', { status: 'done' }, { done: { output: 'child-out' } })
    expect(h.rec('sub')).toMatchObject({ status: 'done', output: 'child-out' })
    h.err(h.call('run', 'boom'), 'nope')
    expect(h.rec('sub').status).toBe('compensating')
    const send = h.effects.find((e) => e.kind === 'child.send' && e.command.type === 'compensate')
    expect(send).toMatchObject({ kind: 'child.send', step: 'sub', command: { type: 'compensate' } })
    // a non-terminal child summary is ignored while compensating; the terminal one completes the entry
    expect(h.child('sub', { status: 'compensating' }).types).toEqual([])
    const done = h.child('sub', { status: 'cancelled' })
    expect(done.types).toEqual(['step.compensated', 'flow.compensated'])
    expect(h.state.status).toBe('failed')
  })

  it('a task failure with an empty stack still goes through flow.compensating → flow.compensated', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: { v: view({ next: 't' }), t: task({ next: 'end' }), end: final() },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.cmd('next')
    const r = h.err(h.call('run'), 'x')
    expect(r.types).toEqual([
      'step.runFailed',
      'step.failed',
      'flow.compensating',
      'flow.compensated',
    ])
    expect(h.state.status).toBe('failed')
    expect(h.state.saga.stack).toEqual([])
  })
})

describe('review follow-ups — grace, resume during settle, repeated completions, timeouts', () => {
  const two = () =>
    flow({
      start: ['a', 'b'],
      steps: {
        a: task({ compensate: comp, next: 'end' }),
        b: task({ compensate: comp, next: 'end' }),
        end: final({ dependsOn: ['a', 'b'] }),
      },
      policies: { onFailure: 'compensate', compensationGraceMs: 5_000 },
    })

  it('grace expiry: unsettled aborted runs are marked orphaned and the unwind starts (one call at a time)', () => {
    const h = createHarness(two())
    h.start()
    h.ok(h.call('run', 'a'), 'A')
    const runB = h.call('run', 'b')
    const r = h.cmd('cancel')
    expect(of(r, 'timer.scheduled')[0]).toMatchObject({
      timerId: 'saga:grace',
      dueAt: h.clock.now + 5_000,
    })
    h.clock.advance(5_000)
    const fired = h.fire('saga:grace')
    expect(fired.types).toEqual(['timer.fired', 'step.runFailed', 'step.compensationStarted'])
    expect(of(fired, 'step.runFailed')[0]).toMatchObject({
      step: 'b',
      willRetry: false,
      error: { code: 'ORPHANED' },
    })
    expect(h.state.saga.settling).toEqual([])
    expect(h.state.saga.stack.map((e) => e.step)).toEqual(['a'])
    expect(h.pending('compensate')).toHaveLength(1)
    // b's very late result is now ignored (cancelled, no longer settling)
    expect(h.ok(runB, 'B').types).toEqual(['result.ignored'])
    h.ok(h.call('compensate'))
    expect(h.state.status).toBe('cancelled')
  })

  it('resume while settling: entries that can never report are dropped, then exactly one unwind call is planned', () => {
    const h = createHarness(two())
    h.start()
    h.ok(h.call('run', 'a'), 'A')
    h.cmd('cancel')
    expect(h.state.saga.settling).toEqual(['b'])
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual([
      'flow.resumed',
      'step.runFailed',
      'timer.cleared',
      'step.compensationStarted',
    ])
    expect(of(r, 'step.runFailed')[0]).toMatchObject({ step: 'b', error: { code: 'INTERRUPTED' } })
    expect(h.state.saga.settling).toEqual([])
    const calls = r.effects.filter((e) => e.kind === 'call')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ hook: 'compensate', step: 'a', timeoutMs: 5_000 })
    expect(r.effects.some((e) => e.kind === 'timer.set')).toBe(false)
  })

  it('a compensate hook that never resolves: the call carries timeoutMs; the timeout is a recorded failure and the unwind continues', () => {
    const h = createHarness(saga())
    runThree(h)
    h.err(h.call('run', 'boom'), 'x')
    const c3 = h.call('compensate')
    expect(c3.timeoutMs).toBe(30_000) // default compensationGraceMs
    const r = h.err(c3, 'compensate timed out', { timedOut: true })
    expect(r.types).toEqual(['step.compensationFailed', 'step.compensationStarted'])
    expect(h.state.saga.failures).toEqual([{ step: 't3', runId: 1 }])
    expect(h.call('compensate').step).toBe('t2')
    // per-step timeoutMs wins over the grace default
    const h2 = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ compensate: comp, timeoutMs: 700, next: 'u' }),
          u: task(),
          end: final(),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h2.start()
    h2.ok(h2.call('run', 't'), 1)
    h2.err(h2.call('run', 'u'), 'x')
    expect(h2.call('compensate').timeoutMs).toBe(700)
  })

  it('the same compensable step completing twice yields two stack entries, compensated in reverse with their own outputs', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ next: 't' }),
          t: task({ compensate: comp, next: 'w' }),
          w: view({ next: 'boom' }),
          boom: task({ next: 'end' }),
          end: final(),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.cmd('next')
    h.ok(h.call('run', 't'), 'first')
    // loop back through t: go(v) → next → t runs again
    h.cmd({ type: 'go', step: 'v' })
    h.cmd('next')
    h.ok(h.call('run', 't'), 'second')
    expect(h.state.saga.stack).toMatchObject([
      { step: 't', runId: 1, output: 'first' },
      { step: 't', runId: 2, output: 'second' },
    ])
    h.cmd('next')
    h.err(h.call('run', 'boom'), 'x')
    expect(of(h.log, 'flow.compensating').at(-1)?.plan).toEqual(['t', 't'])
    const c2 = h.call('compensate')
    expect(c2).toMatchObject({ token: { step: 't', runId: 2 }, extra: { output: 'second' } })
    // a stale result for the other entry is ignored
    expect(
      h.step({
        ...c2,
        type: 'res.ok',
        value: undefined,
        durationMs: 0,
        token: { step: 't', runId: 1 },
      } as never).types,
    ).toEqual(['result.ignored'])
    h.ok(c2)
    const c1 = h.call('compensate')
    expect(c1).toMatchObject({ token: { step: 't', runId: 1 }, extra: { output: 'first' } })
    const fin = h.ok(c1)
    expect(fin.types).toEqual(['step.compensated', 'flow.compensated'])
    expect(h.state.saga.compensated).toEqual([
      { step: 't', runId: 2 },
      { step: 't', runId: 1 },
    ])
  })

  it('a done child summary during parent compensation is not a success; only phase:compensated (or failed/cancelled) completes the entry', () => {
    const child = flow({ name: 'child', start: 'x', steps: { x: final() } })
    const h = createHarness(
      flow({
        start: 'sub',
        steps: {
          sub: flowStep(child, { compensate: comp, next: 'boom' }),
          boom: task({ next: 'end' }),
          end: final(),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('childContext'), {})
    h.child('sub', { status: 'done' }, { done: { output: 1 } })
    h.err(h.call('run', 'boom'), 'x')
    expect(h.rec('sub').status).toBe('compensating')
    expect(h.child('sub', { status: 'done' }, { done: { output: 1 } }).types).toEqual([])
    expect(h.rec('sub').status).toBe('compensating')
    const done = h.child('sub', { status: 'cancelled' }, { phase: 'compensated' })
    expect(done.types).toEqual(['step.compensated', 'flow.compensated'])
  })
})
