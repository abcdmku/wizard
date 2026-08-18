import { describe, expect, it } from 'vitest'
import { available, explain, phase, progress, ready } from '../../src/machine/index'
import { createHarness, decision, final, flow, of, task, view, wait } from '../helpers/fixtures'

describe('deriveStatus table', () => {
  it('idle → waiting (view) → running (task) → waiting (wait) → done', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ next: 't' }),
          t: task({ next: 'w' }),
          w: wait({ on: { go: () => undefined }, next: 'end' }),
          end: final(),
        },
      }),
    )
    expect(h.state.status).toBe('idle')
    h.start()
    expect(h.state.status).toBe('waiting')
    h.cmd('next')
    expect(h.state.status).toBe('running')
    h.ok(h.call('run'), 1)
    expect(h.state.status).toBe('waiting')
    h.cmd({ type: 'send', event: 'go', payload: 1 })
    h.ok(h.call('on'), undefined)
    expect(h.state.status).toBe('done')
  })

  it('started with nothing active (dead end) → waiting; a decision alone → running', () => {
    const h = createHarness(
      flow({ start: 'd', steps: { d: decision({ decide: () => null }), x: final() } }),
    )
    h.start()
    expect(h.state.status).toBe('running')
    h.ok(h.call('next'), null)
    expect(h.state.status).toBe('waiting')
    expect(h.state.active).toEqual([])
    expect(explain(h.def, h.state, 'x').reasons).toEqual(['not-activated'])
  })

  it('failed (halt) is not sticky: recovers when the failed step is retried; AUTO/compensated failures are terminal', () => {
    const h = createHarness(flow({ start: 't', steps: { t: task({ next: 'end' }), end: final() } }))
    h.start()
    h.err(h.call('run'), 'x')
    expect(h.state.status).toBe('failed')
    h.cmd({ type: 'retry', step: 't' })
    expect(h.state.status).toBe('running')
    h.err(h.call('run'), 'x again')
    expect(h.state.status).toBe('failed')
    expect(of(h.cmd('start'), 'command.rejected')[0]?.code).toBe('INVALID_COMMAND') // already started
    expect(h.cmd({ type: 'cancel' }).types).toEqual(['flow.cancelled'])
    expect(h.state.status).toBe('cancelled')
    expect(of(h.cmd({ type: 'retry', step: 't' }), 'command.rejected')[0]?.code).toBe(
      'FLOW_TERMINAL',
    )
  })

  it('compensating → compensated outcome; flow.status is not emitted (status is stored)', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: task({ compensate: () => undefined, next: 'u' }), u: task(), end: final() },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('run', 't'), 1)
    h.err(h.call('run', 'u'), 'x')
    expect(h.state.status).toBe('compensating')
    h.ok(h.call('compensate'))
    expect(h.state.status).toBe('failed')
    expect(h.log.some((e) => e.type === 'flow.status')).toBe(false)
  })
})

describe('gates: not-started / terminal / compensating', () => {
  const simple = () => flow({ start: 'v', steps: { v: view({ next: 'end' }), end: final() } })

  it('before start: only start/reset/setInput/resetInput are accepted', () => {
    const h = createHarness(simple())
    expect(of(h.cmd('next'), 'transition.rejected')[0]?.reason).toBe('flow-not-started')
    expect(of(h.cmd({ type: 'send', event: 'x', payload: 1 }), 'command.rejected')[0]?.code).toBe(
      'FLOW_NOT_STARTED',
    )
    expect(of(h.cmd('cancel'), 'command.rejected')[0]?.code).toBe('FLOW_NOT_STARTED')
    expect(of(h.cmd('runReady'), 'command.rejected')[0]?.code).toBe('FLOW_NOT_STARTED')
    expect(h.cmd({ type: 'setInput', step: 'v', patch: { a: 1 } }).types).toEqual(['input.changed'])
    expect(h.rec('v').input).toEqual({ a: 1 })
    expect(h.cmd('reset').types).toEqual(['flow.reset'])
    h.start()
    expect(of(h.cmd('start'), 'command.rejected')[0]?.code).toBe('INVALID_COMMAND')
  })

  it('terminal: everything but reset is rejected FLOW_TERMINAL (nav → transition.rejected{flow-terminal})', () => {
    const h = createHarness(simple())
    h.start()
    h.cmd('next')
    expect(h.state.status).toBe('done')
    for (const c of ['next', 'back', 'runReady', 'cancel', 'compensate'] as const) {
      const r = h.cmd(c)
      const rejected =
        r.types[0] === 'transition.rejected'
          ? of(r, 'transition.rejected')[0]?.reason
          : of(r, 'command.rejected')[0]?.code
      expect(rejected, c).toMatch(/flow-terminal|FLOW_TERMINAL/)
    }
    expect(of(h.cmd({ type: 'setInput', step: 'v', patch: {} }), 'command.rejected')[0]?.code).toBe(
      'FLOW_TERMINAL',
    )
    expect(h.cmd('reset').types).toEqual(['flow.reset'])
    expect(h.state.status).toBe('idle')
  })

  it('unknown message types and unknown steps are handled without throwing', () => {
    const h = createHarness(simple())
    h.start()
    expect(h.step({ type: 'bogus' } as never).types).toEqual([])
    expect(
      of(h.cmd({ type: 'setInput', step: 'zzz', patch: {} }), 'command.rejected')[0]?.code,
    ).toBe('UNKNOWN_STEP')
    expect(
      of(h.cmd({ type: 'setInput', step: 'end', patch: {} }), 'command.rejected')[0]?.code,
    ).toBe('NOT_A_VIEW')
    expect(of(h.cmd({ type: 'retry', step: 'zzz' }), 'command.rejected')[0]?.code).toBe(
      'UNKNOWN_STEP',
    )
  })
})

describe('token staleness', () => {
  it('unknown step / runId / attempt / txId mismatches → result.ignored and nothing else', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ canExit: () => true, next: 't' }),
          t: task({ retry: { attempts: 1 }, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const canExit = h.call('canExit')
    // txId mismatch (a stale transaction)
    const staleTx = h.step({
      ...h.pending('canExit')[0]!,
      type: 'res.ok',
      value: true,
      durationMs: 0,
      token: { ...canExit.token, txId: 'tx-old' },
    } as never)
    expect(staleTx.types).toEqual(['result.ignored'])
    expect(of(staleTx, 'result.ignored')[0]?.reason).toBe('stale')
    h.ok(canExit, true)
    const run = h.call('run')
    // runId mismatch
    expect(
      h.step({
        type: 'res.ok',
        effectId: 'x',
        hook: 'run',
        token: { step: 't', runId: 99, attempt: 1 },
        value: 1,
        durationMs: 0,
      }).types,
    ).toEqual(['result.ignored'])
    // attempt mismatch
    expect(
      h.step({
        type: 'res.ok',
        effectId: 'x',
        hook: 'run',
        token: { step: 't', runId: 1, attempt: 7 },
        value: 1,
        durationMs: 0,
      }).types,
    ).toEqual(['result.ignored'])
    // unknown step
    const unknown = h.step({
      type: 'res.ok',
      effectId: 'x',
      hook: 'run',
      token: { step: 'nope', runId: 1 },
      value: 1,
      durationMs: 0,
    })
    expect(of(unknown, 'result.ignored')[0]?.reason).toBe('unknown-step')
    // the real one still works; a second delivery of it is stale (attempt matches but the run is over)
    expect(h.ok(run, 'ok').types.slice(0, 2)).toEqual(['step.runSucceeded', 'step.done'])
    expect(h.ok(run, 'ok again').types).toEqual(['result.ignored'])
  })

  it('a hook result for a step that was re-entered (new runId) is stale', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ enter: () => undefined, next: 'b' }),
          b: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const enter1 = h.call('enter') // scheduler entry of a (runId 1)
    h.ok(enter1)
    h.cmd('next')
    h.cmd('back') // a re-entered → enter runs in the entering phase with runId token 1? no: a's runId is still 1 pre-entry
    const enter2 = h.call('enter')
    expect(enter2.token).toMatchObject({ step: 'a', runId: 1 })
    expect(enter2.token.txId).toBeDefined()
    h.ok(enter2)
    expect(h.rec('a').runId).toBe(2)
    // replaying the very first enter result now (runId 1 vs 2) is stale
    expect(h.ok(enter1).types).toEqual(['result.ignored'])
  })
})

describe('data commands', () => {
  it('setInput shallow-merges objects, replaces non-objects, clears issues; resetInput restores initial', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: { v: view({ initial: { name: '', qty: 1 }, next: 'end' }), end: final() },
      }),
    )
    h.start()
    expect(h.rec('v').input).toEqual({ name: '', qty: 1 }) // seeded on first entry
    h.cmd({ type: 'setInput', step: 'v', patch: { name: 'x' } })
    expect(h.rec('v').input).toEqual({ name: 'x', qty: 1 })
    h.cmd({ type: 'setInput', step: 'v', patch: 'raw' })
    expect(h.rec('v').input).toBe('raw')
    h.cmd({ type: 'setInput', step: 'v', patch: { a: 1 } })
    expect(h.rec('v').input).toEqual({ a: 1 })
    const r = h.cmd({ type: 'resetInput', step: 'v' })
    expect(of(r, 'input.changed')[0]).toMatchObject({ reset: true, patch: { name: '', qty: 1 } })
    expect(h.rec('v').input).toEqual({ name: '', qty: 1 })
  })

  it('context.patch (from update()) → context.changed shallow merge; ignored once terminal', () => {
    const h = createHarness(
      flow({ start: 'v', steps: { v: view({ next: 'end' }), end: final() } }),
      { context: { a: 1 } },
    )
    h.start()
    const r = h.step({ type: 'context.patch', patch: { b: 2 }, by: 'v' })
    expect(r.types).toEqual(['context.changed'])
    expect(of(r, 'context.changed')[0]).toMatchObject({ patch: { b: 2 }, by: 'v' })
    expect(h.state.context).toEqual({ a: 1, b: 2 })
    h.cmd('next')
    expect(h.step({ type: 'context.patch', patch: { c: 3 } }).types).toEqual([])
  })
})

describe('plan sees the post-batch state', () => {
  it('no effect is planned for a phase the batch already moved past; step.runStarted plans exactly one run call', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: { v: view({ next: 't' }), t: task({ next: 'end' }), end: final() },
      }),
    )
    h.start()
    const r = h.cmd('next')
    expect(of(r, 'transition.phase')).toHaveLength(7)
    const calls = r.effects.filter((e) => e.kind === 'call')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      hook: 'run',
      step: 't',
      token: { step: 't', runId: 1, attempt: 1 },
    })
    expect(r.effects.map((e) => e.kind)).toEqual(['settle', 'call', 'persist'])
  })

  it('explain reports flow-level reasons (terminal / compensating) and unknown steps', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: task({ compensate: () => undefined, next: 'u' }), u: task(), end: final() },
        policies: { onFailure: 'compensate' },
      }),
    )
    h.start()
    h.ok(h.call('run', 't'), 1)
    h.err(h.call('run', 'u'), 'x')
    expect(explain(h.def, h.state, 't')).toMatchObject({
      status: 'compensating',
      phase: 'compensating',
      reasons: ['flow-compensating'],
    })
    h.ok(h.call('compensate'))
    expect(explain(h.def, h.state, 'u').reasons).toEqual(['flow-terminal', 'failed:run'])
  })
})

describe('selectors and explain', () => {
  it('phase / ready / available / progress / explain reasons', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t', 'b', 'c'] }),
          t: task({ retry: { attempts: 1, backoff: 10 } }),
          b: view({ dependsOn: ['t'], canEnter: () => true, next: 'end' }),
          c: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    const d = h.def
    expect(explain(d, h.state, 'a').reasons).toEqual(['flow-not-started', 'not-activated'])
    expect(explain(d, h.state, 'zzz')).toMatchObject({
      status: 'unknown',
      reasons: ['unknown-step'],
    })
    h.start()
    expect(phase(d, h.state, 'a')).toBe('waiting')
    h.cmd('next') // fan-out: b has canEnter → answered first
    h.ok(h.call('canEnter'), true)
    // t runs, b blocked, c current
    expect(h.state.current).toBe('c')
    expect(phase(d, h.state, 't')).toBe('running')
    expect(phase(d, h.state, 'b')).toBe('blocked')
    expect(explain(d, h.state, 'b').reasons).toEqual(['deps-unmet:t'])
    expect(available(d, h.state, 'b')).toBe(false)
    expect(available(d, h.state, 'a')).toBe(true) // visited
    expect(available(d, h.state, 'c')).toBe(false) // current
    h.err(h.call('run'), 'x')
    expect(phase(d, h.state, 't')).toBe('retrying')
    expect(explain(d, h.state, 't').reasons).toEqual(['retrying'])
    h.fire('retry:t')
    h.ok(h.call('run'), 1)
    expect(ready(d, h.state, 'b')).toBe(true)
    expect(phase(d, h.state, 'b')).toBe('ready')
    expect(available(d, h.state, 'b')).toBe(true)
    expect(explain(d, h.state, 'b').candidates).toEqual(['b'])
    expect(progress(h.state)).toBeCloseTo(2 / 5)
    // go to b: canEnter false → guard reason
    h.cmd({ type: 'go', step: 'b' })
    expect(phase(d, h.state, 'c')).toBe('exiting')
    expect(explain(d, h.state, 'b').reasons).toEqual(['nav-busy'])
    h.ok(h.call('canEnter'), false)
    expect(explain(d, h.state, 'b').reasons).toEqual(['guard-false:canEnter'])
    // memoized per state object
    expect(explain(d, h.state, 'b')).toEqual(explain(d, h.state, 'b'))
  })
})

describe("strict: 'sync' violations", () => {
  it('a run result flagged syncViolation fails the step as sync-violation without retries; other hooks likewise', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ retry: { attempts: 3 }, next: 'd' }),
          d: decision({ decide: () => 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const run = h.call('run')
    const r = h.step({
      type: 'res.err',
      effectId: run.effectId,
      hook: 'run',
      token: run.token,
      error: { name: 'SyncViolationError', message: 'thenable', code: 'SYNC_VIOLATION' },
      durationMs: 0,
      syncViolation: true,
    })
    expect(r.types).toEqual(['step.runFailed', 'step.failed', 'flow.failed'])
    expect(of(r, 'step.runFailed')[0]?.willRetry).toBe(false)
    expect(h.rec('t').error).toMatchObject({ kind: 'sync-violation', code: 'SYNC_VIOLATION' })
    expect(h.state.timers).toEqual({})
    // a decision's next hook
    const h2 = createHarness(
      flow({ start: 'd', steps: { d: decision({ decide: () => 'end' }), end: final() } }),
    )
    h2.start()
    const next = h2.call('next')
    const r2 = h2.step({
      type: 'res.err',
      effectId: next.effectId,
      hook: 'next',
      token: next.token,
      error: { name: 'SyncViolationError', message: 'thenable', code: 'SYNC_VIOLATION' },
      durationMs: 0,
      syncViolation: true,
    })
    expect(of(r2, 'step.failed')[0]?.kind).toBe('sync-violation')
  })
})
