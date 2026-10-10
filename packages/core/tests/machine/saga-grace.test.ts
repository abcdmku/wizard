/**
 * Saga (§5.2 / plan §8.5) — grace period, resume during settle, repeated completions and timeouts.
 */
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
