import { describe, expect, it } from 'vitest'
import {
  createHarness,
  eventStep,
  flow,
  of,
  replay,
  routingStep,
  runStep,
  view,
} from '../helpers/fixtures'

const on = () => undefined

describe('replay(log) == state', () => {
  it('fixture 1: linear run with a retried task and a back()', () => {
    const h = createHarness(
      flow({
        name: 'run',
        start: 'a',
        steps: {
          a: view({ initial: { n: 0 }, next: 'b' }),
          b: view({ canExit: () => true, next: 't' }),
          t: runStep({ retry: { retries: 1, backoff: 100 }, next: 'c' }),
          c: view({ next: 'end' }),
          end: runStep({ run: () => 'bye' }),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'setInput', step: 'a', patch: { n: 1 } })
    h.cmd('next')
    h.cmd('back')
    h.cmd('next')
    h.cmd('next')
    h.ok(h.call('canExit'), true)
    h.err(h.call('run'), 'flaky')
    h.clock.advance(100)
    h.fire('retry:t')
    h.ok(h.call('run'), { ok: true })
    h.cmd('next')
    h.ok(h.call('run', 'end'), 'bye')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(replay(h)).toEqual(h.state)
    expect(h.log.map((e) => e.seq)).toEqual(h.log.map((_, i) => i + 1))
  })

  it('fixture 2: saga with cancellation during a run, partial compensation failure and a re-run', () => {
    const c = () => undefined
    const h = createHarness(
      flow({
        name: 'saga',
        start: ['t1', 't2'],
        steps: {
          t1: runStep({ compensate: c, next: 't3' }),
          t2: runStep({ compensate: c, next: 't3' }),
          t3: runStep({ compensate: c, dependsOn: ['t1', 't2'], next: 'end' }),
          end: routingStep(),
        },
        policies: { onFailure: 'compensate', concurrency: 2 },
      }),
    )
    h.start()
    h.ok(h.call('run', 't1'), 1)
    const t2 = h.call('run', 't2')
    h.cmd({ type: 'cancel', reason: 'abort' })
    h.ok(t2, 2) // late success → pushed → unwind starts (t2, then t1)
    h.err(h.call('compensate'), 'no')
    h.ok(h.call('compensate'))
    expect(h.state.status).toBe('cancelled')
    h.cmd({ type: 'compensate', from: 't2' })
    h.ok(h.call('compensate'))
    expect(h.state.saga.failures).toEqual([])
    expect(replay(h)).toEqual(h.state)
  })

  it('fixture 3: waits with buffered/expired events, drain on enter, keep and a timeout', () => {
    const h = createHarness(
      flow({
        name: 'waits',
        start: 'v',
        steps: {
          v: view({ next: ['w', 'x'] }),
          w: eventStep({
            on: { a: on, b: on },
            timeout: { afterMs: 500, next: 'late' },
            next: 'x',
          }),
          x: eventStep({ on: { z: on }, next: 'end' }),
          late: routingStep(),
          end: routingStep({ dependsOn: ['w', 'x'] }),
        },
        policies: { unmatchedEvents: { buffer: true, ttlMs: 1_000 } },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'a', payload: 'early-a' })
    h.cmd({ type: 'send', event: 'q', payload: 'never' })
    h.clock.advance(1_000)
    h.fire('inbox:evt-2')
    h.cmd({ type: 'send', event: 'b', payload: 'early-b' })
    h.cmd('next') // w + x enter; w drains 'a' (expired? no: evt-1 expired at 2000 → now is 2000 → expired!)
    h.cmd({ type: 'send', event: 'z', payload: 'zz' })
    for (const call of h.pending('on')) h.ok(call, { keep: true })
    h.clock.advance(500)
    h.fire('wait:w')
    expect(replay(h)).toEqual(h.state)
    // sanity: the flow reached the timeout branch
    expect(h.rec('late').status).toBe('done')
    expect(h.rec('x').status).toBe('active')
    h.cmd({ type: 'send', event: 'z', payload: 'finished' })
    h.ok(h.call('on', 'x'))
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(replay(h)).toEqual(h.state)
  })
})

describe('resume matrix (§8.8)', () => {
  it('nav in flight → transition.rejected{resumed}; from stays active; the promise is settled', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ canExit: () => true, next: 'b' }),
          b: view({ next: 'end' }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const tx = h.state.nav.txId
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['flow.resumed', 'transition.rejected'])
    expect(of(r, 'flow.resumed')[0]).toMatchObject({ fromSeq: h.state.seq - 2, interrupted: [] })
    expect(of(r, 'transition.rejected')[0]).toMatchObject({ txId: tx, reason: 'resumed' })
    expect(h.state.nav.phase).toBe('idle')
    expect(h.state.current).toBe('a')
    expect(r.effects.map((e) => e.kind)).toEqual(['settle', 'persist'])
  })

  it('running task → step.failed{interrupted} + flow.failed; retry re-runs it', () => {
    const h = createHarness(
      flow({ start: 't', steps: { t: runStep({ next: 'end' }), end: routingStep() } }),
    )
    h.start()
    const r = h.step({ type: 'resume', fromSeq: 3 })
    expect(r.types).toEqual(['flow.resumed', 'step.failed', 'flow.halted'])
    expect(of(r, 'flow.resumed')[0]?.interrupted).toEqual(['t'])
    expect(h.rec('t').error).toMatchObject({ kind: 'interrupted', code: 'INTERRUPTED' })
    expect(h.state.status).toBe('halted')
    expect(h.cmd({ type: 'retry', step: 't' }).types).toEqual(['step.runStarted'])
    expect(h.call('run').token).toEqual({ step: 't', runId: 1, attempt: 1 })
  })

  it('an interrupted task never triggers compensation (even with onFailure: compensate)', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: runStep({ compensate: () => undefined, next: 'b' }),
          b: runStep({ next: 'end' }),
          end: routingStep(),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('run', 'a'), 1)
    const r = h.step({ type: 'resume', fromSeq: 1 })
    expect(r.types).toEqual(['flow.resumed', 'step.failed', 'flow.halted'])
    expect(h.state.status).toBe('halted')
    expect(h.state.saga.stack.map((e) => e.step)).toEqual(['a'])
  })

  it('task with an overdue retryAt → the retry fires in the resume batch; wait deadline not due: inbox drained, timer re-armed', () => {
    const h = createHarness(
      flow({
        start: ['t', 'w'],
        steps: {
          t: runStep({ retry: { retries: 1, backoff: 1_000 } }),
          w: eventStep({ on: { e: on }, timeout: { afterMs: 5_000, next: 'end' } }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    h.err(h.call('run'), 'x')
    const retryAt = h.rec('t').retryAt!
    const deadline = h.rec('w').deadline!
    // an event that arrived while the wait was listening but the interpreter died before delivering: it sits in the inbox
    h.state = {
      ...h.state,
      inbox: [{ id: 'evt-9', event: 'e', payload: 'p', at: 0, expiresAt: h.clock.now + 60_000 }],
    }
    h.clock.advance(2_000) // retry overdue, deadline not yet
    expect(retryAt).toBeLessThan(h.clock.now)
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['flow.resumed', 'timer.fired', 'step.runStarted', 'event.delivered'])
    expect(of(r, 'step.runStarted')[0]).toMatchObject({ step: 't', attempt: 2 })
    expect(of(r, 'event.delivered')[0]).toMatchObject({ to: 'w', inboxId: 'evt-9' })
    expect(r.effects.filter((e) => e.kind === 'timer.set')).toEqual([
      {
        kind: 'timer.set',
        timerId: 'wait:w',
        at: deadline,
        fire: { type: 'timer.fired', timerId: 'wait:w' },
      },
    ])
    // the retry and the delivery are planned as calls
    expect(r.effects.flatMap((e) => (e.kind === 'call' ? [e.hook] : []))).toEqual(['run', 'on'])
  })

  it('expired inbox entries are dropped on resume', () => {
    const h = createHarness(
      flow({ start: 'v', steps: { v: view({ next: 'end' }), end: routingStep() } }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'x', payload: 1 })
    h.clock.advance(60_000)
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['flow.resumed', 'timer.cleared', 'event.expired'])
    expect(h.state.inbox).toEqual([])
  })

  it('compensating → the in-flight compensate call is re-issued and unwinding continues', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: runStep({ compensate: () => undefined, next: 'u' }),
          u: runStep(),
          end: routingStep(),
        },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('run', 't'), 1)
    h.err(h.call('run', 'u'), 'x')
    expect(h.rec('t').status).toBe('compensating')
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['flow.resumed'])
    expect(r.effects.filter((e) => e.kind === 'call')).toMatchObject([
      { hook: 'compensate', step: 't' },
    ])
    h.ok(h.call('compensate'))
    expect(h.state.status).toBe('failed')
  })

  it('in-flight enter / routing next hooks are re-issued; terminal flows only record flow.resumed', () => {
    const h = createHarness(
      flow({
        start: ['e', 'd'],
        steps: {
          e: runStep({ enter: () => undefined }),
          d: routingStep({ decide: () => 'end', targets: ['end'] }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['flow.resumed'])
    expect(r.effects.filter((e) => e.kind === 'call').map((e) => [e.hook, e.step])).toEqual([
      ['enter', 'e'],
      ['next', 'd'],
    ])
    // finish and resume again
    h.ok(h.call('next'), 'end')
    expect(h.rec('e').entering).toBe(true)
    h.ok(h.call('enter', 'e'))
    h.ok(h.call('run', 'e'))
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    const t = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(t.types).toEqual(['flow.resumed'])
    expect(t.effects.filter((e) => e.kind === 'call')).toEqual([])
    expect(of(h.cmd('next'), 'transition.rejected')[0]?.reason).toBe('flow-terminal')
  })
})

describe('review follow-ups — resume effect ordering, persistence of no-op batches', () => {
  it('every non-empty batch is persisted, including rejected commands and ignored results', () => {
    const h = createHarness(
      flow({ start: 'v', steps: { v: view({ next: 'end' }), end: routingStep() } }),
    )
    const rejected = h.cmd('next') // not started
    expect(rejected.types).toEqual(['transition.rejected'])
    expect(rejected.effects.map((e) => e.kind)).toEqual(['settle', 'persist'])
    h.start()
    const bad = h.cmd({ type: 'setInput', step: 'nope', patch: {} })
    expect(bad.types).toEqual(['command.rejected'])
    expect(bad.effects).toEqual([{ kind: 'persist', reason: 'change' }])
    const stale = h.step({
      type: 'res.ok',
      effectId: 'x',
      hook: 'run',
      token: { step: 'v', runId: 99 },
      value: 1,
      durationMs: 0,
    })
    expect(stale.types).toEqual(['result.ignored'])
    expect(stale.effects).toEqual([{ kind: 'persist', reason: 'change' }])
    // and a truly empty batch plans nothing
    expect(h.step({ type: 'timer.fired', timerId: 'nope' }).effects).toEqual([])
    expect(replay(h)).toEqual(h.state)
  })
})
