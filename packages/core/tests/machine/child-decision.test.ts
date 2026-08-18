import { describe, expect, it } from 'vitest'
import { createHarness, decision, final, flow, flowStep, of, task, view } from '../helpers/fixtures'

describe('decision', () => {
  const routed = () =>
    flow({
      start: 'v',
      steps: {
        v: view({ next: 'route' }),
        route: decision({ decide: () => 'yes' }),
        yes: final(),
        no: final(),
        both: task(),
      },
    })

  it('entering a decision plans call next (token step/runId); the result is the output and the auto-advance target', () => {
    const h = createHarness(routed())
    h.start()
    const r = h.cmd('next')
    expect(r.types.slice(-2)).toEqual(['transition.committed', 'step.entered'])
    expect(h.state.status).toBe('running')
    const call = h.call('next')
    expect(call).toMatchObject({ step: 'route', hook: 'next', token: { step: 'route', runId: 1 } })
    expect(call.token.txId).toBeUndefined()
    const done = h.ok(call, 'no')
    expect(done.types.slice(0, 2)).toEqual(['step.done', 'transition.started'])
    expect(h.rec('route').output).toEqual(['no']) // the NORMALIZED target list (OutputOf<decision> = readonly N[])
    expect(of(done, 'transition.committed')[0]).toMatchObject({
      from: 'route',
      to: 'no',
      cause: 'auto',
    })
    expect(h.state.status).toBe('done')
    expect(h.rec('no').status).toBe('done')
  })

  it('a decision returning several targets fans out; null → dead end (done, nothing arrives); unknown → step.failed', () => {
    const fan = createHarness(routed())
    fan.start()
    fan.cmd('next')
    const r = fan.ok(fan.call('next'), ['both', 'yes'])
    expect(of(r, 'step.arrived').map((e) => e.step)).toEqual(['both', 'yes'])
    expect(fan.rec('route').output).toEqual(['both', 'yes']) // stored as-is (already a list)
    expect(fan.state.status).toBe('done') // yes is a final → cancels both
    expect(fan.rec('both').status).toBe('cancelled')

    const dead = createHarness(routed())
    dead.start()
    dead.cmd('next')
    const d = dead.ok(dead.call('next'), null)
    expect(d.types).toEqual(['step.done'])
    expect(dead.rec('route').output).toEqual([]) // null → [] (normalized; JSON-safe, no undefined)
    expect(of(d, 'step.done')[0]?.output).toEqual([])
    expect(dead.state.status).toBe('waiting')

    const bad = createHarness(routed())
    bad.start()
    bad.cmd('next')
    const b = bad.ok(bad.call('next'), 'nope')
    expect(b.types).toEqual(['step.failed', 'flow.failed'])
    expect(bad.rec('route').error).toMatchObject({ kind: 'hook', code: 'UNKNOWN_STEP' })
  })

  it('decision hook error → step.failed{kind:hook} + policy', () => {
    const h = createHarness(routed())
    h.start()
    h.cmd('next')
    const r = h.err(h.call('next'), 'cannot decide')
    expect(r.types).toEqual(['step.failed', 'flow.failed'])
    expect(h.state.status).toBe('failed')
  })
})

describe('nested flow steps', () => {
  const child = flow({ name: 'child', start: 'x', steps: { x: final() } })
  const parent = (opts: { output?: boolean } = {}) =>
    flow({
      start: 'sub',
      steps: {
        sub: flowStep(child, {
          context: () => ({ a: 1 }),
          next: 'end',
          ...(opts.output ? { output: () => 'mapped' } : {}),
        }),
        end: final(),
      },
    })

  it('entering a flow step: call childContext → child.started{childPath, context} → child.create; summaries are stored', () => {
    const h = createHarness(parent(), { path: ['root'] })
    h.start()
    const cc = h.call('childContext')
    expect(cc.token).toEqual({ step: 'sub', runId: 1 })
    const r = h.ok(cc, { a: 1 })
    expect(r.types).toEqual(['child.started'])
    expect(of(r, 'child.started')[0]).toEqual(
      expect.objectContaining({ step: 'sub', childPath: ['root', 'sub'], context: { a: 1 } }),
    )
    expect(r.effects[0]).toEqual({ kind: 'child.create', step: 'sub', context: { a: 1 } })
    expect(h.state.status).toBe('running')
    const s = h.child('sub', { status: 'waiting', current: 'x', progress: 0.5, seq: 3 })
    expect(s.types).toEqual(['child.summary'])
    expect(h.rec('sub').child).toEqual({ status: 'waiting', current: 'x', progress: 0.5, seq: 3 })
    expect(h.state.status).toBe('waiting') // child is waiting on a view
    // repeated summaries are fine
    h.child('sub', { status: 'running', seq: 4 })
    expect(h.state.status).toBe('running')
  })

  it('child done without childOutput hook → step.done{output} + auto-advance; done acts once', () => {
    const h = createHarness(parent())
    h.start()
    h.ok(h.call('childContext'), {})
    const r = h.child('sub', { status: 'done', seq: 9 }, { done: { output: { total: 3 } } })
    expect(r.types.slice(0, 2)).toEqual(['child.summary', 'step.done'])
    expect(of(r, 'child.summary')[0]?.done).toEqual({ output: { total: 3 } })
    expect(h.rec('sub')).toMatchObject({ status: 'done', output: { total: 3 } })
    expect(h.state.status).toBe('done')
    // a duplicate terminal summary after completion is ignored
    expect(
      h.child('sub', { status: 'done', seq: 10 }, { done: { output: { total: 3 } } }).types,
    ).toEqual([])
  })

  it('child done with childOutput hook → call childOutput{extra.output}; its value is the step output', () => {
    const h = createHarness(parent({ output: true }))
    h.start()
    h.ok(h.call('childContext'), {})
    const r = h.child('sub', { status: 'done' }, { done: { output: 'raw' } })
    expect(r.types).toEqual(['child.summary'])
    const co = h.call('childOutput')
    expect(co).toMatchObject({ step: 'sub', extra: { output: 'raw' } })
    // a second terminal summary does not re-plan the hook
    expect(h.child('sub', { status: 'done' }, { done: { output: 'raw' } }).types).toEqual([
      'child.summary',
    ])
    expect(h.pending('childOutput')).toHaveLength(1)
    const d = h.ok(co, 'mapped')
    expect(of(d, 'step.done')[0]?.output).toBe('mapped')
    expect(h.state.status).toBe('done')
  })

  it('child failed → step.failed{kind:child} + policy; childContext error → step.failed{kind:hook}', () => {
    const h = createHarness(parent())
    h.start()
    h.ok(h.call('childContext'), {})
    const r = h.child(
      'sub',
      { status: 'failed' },
      { failed: { error: { name: 'Error', message: 'child broke' } } },
    )
    expect(r.types).toEqual(['child.summary', 'step.failed', 'flow.failed'])
    expect(h.rec('sub').error).toMatchObject({ kind: 'child', message: 'child broke' })

    const h2 = createHarness(parent())
    h2.start()
    expect(h2.err(h2.call('childContext'), 'no ctx').types).toEqual(['step.failed', 'flow.failed'])
  })

  it('child command: forwarded via child.command → child.send (path peeled one level); rejections', () => {
    const h = createHarness(parent())
    h.start()
    h.ok(h.call('childContext'), {})
    const r = h.cmd({ type: 'child', path: ['sub'], command: { type: 'next' } })
    expect(r.types).toEqual(['child.command'])
    expect(r.effects[0]).toEqual({ kind: 'child.send', step: 'sub', command: { type: 'next' } })
    const deep = h.cmd({ type: 'child', path: ['sub', 'inner'], command: { type: 'back' } })
    expect(deep.effects[0]).toEqual({
      kind: 'child.send',
      step: 'sub',
      command: { type: 'child', path: ['inner'], command: { type: 'back' } },
    })
    expect(
      of(h.cmd({ type: 'child', path: ['end'], command: { type: 'next' } }), 'command.rejected')[0]
        ?.code,
    ).toBe('NOT_A_FLOW_STEP')
    expect(
      of(h.cmd({ type: 'child', path: ['zzz'], command: { type: 'next' } }), 'command.rejected')[0]
        ?.code,
    ).toBe('UNKNOWN_STEP')
    expect(
      of(h.cmd({ type: 'child', path: [], command: { type: 'next' } }), 'command.rejected')[0]
        ?.code,
    ).toBe('INVALID_COMMAND')
  })

  it('cancelling a flow with a running child sends cancel to the child; a summary for an unknown step is ignored', () => {
    const h = createHarness(parent())
    h.start()
    h.ok(h.call('childContext'), {})
    const r = h.cmd({ type: 'cancel', reason: 'stop' })
    expect(r.effects[0]).toEqual({
      kind: 'child.send',
      step: 'sub',
      command: { type: 'cancel', reason: 'stop' },
    })
    expect(of(h.child('ghost', { status: 'done' }), 'result.ignored')[0]?.reason).toBe(
      'unknown-step',
    )
    // a summary for a no-longer-active step is silently ignored
    expect(h.child('sub', { status: 'cancelled' }).types).toEqual([])
  })

  it('reset: clears timers, returns to the initial state (keeping instanceId/epoch/context) and disposes children', () => {
    const h = createHarness(parent(), { context: { user: 'u' } })
    h.start()
    h.ok(h.call('childContext'), {})
    const before = h.state
    const r = h.cmd('reset')
    expect(r.types).toEqual(['flow.reset'])
    expect(r.effects).toEqual([
      { kind: 'child.dispose', step: 'sub' },
      { kind: 'persist', reason: 'change' },
    ])
    expect(h.state).toMatchObject({
      status: 'idle',
      current: null,
      active: [],
      history: [],
      instanceId: before.instanceId,
      epoch: before.epoch,
      context: { user: 'u' },
    })
    expect(h.state.seq).toBe(before.seq + 1)
    expect(h.rec('sub')).toMatchObject({ status: 'idle', runId: 0, visitedCount: 0 })
    // and it can start again
    h.start()
    expect(h.rec('sub').status).toBe('active')
  })
})

describe('review follow-ups — child result freshness, halt with a running child', () => {
  const child = flow({ name: 'child', start: 'x', steps: { x: final() } })

  it('res.child is ignored for an old parent run, a duplicate/decreasing summary seq, a wrong kind or an unknown step', () => {
    const h = createHarness(
      flow({
        start: 'sub',
        steps: {
          sub: flowStep(child, { next: 'end' }),
          t: task(),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('childContext'), {})
    expect(h.child('sub', { status: 'running', seq: 5 }).types).toEqual(['child.summary'])
    // duplicate / decreasing seq
    expect(of(h.child('sub', { status: 'waiting', seq: 5 }), 'result.ignored')[0]?.reason).toBe(
      'stale',
    )
    expect(of(h.child('sub', { status: 'waiting', seq: 4 }), 'result.ignored')[0]?.reason).toBe(
      'stale',
    )
    expect(h.rec('sub').child?.status).toBe('running')
    // old parent run
    expect(
      of(
        h.child(
          'sub',
          { status: 'done', seq: 9 },
          { done: { output: 1 }, token: { step: 'sub', runId: 0 } },
        ),
        'result.ignored',
      )[0]?.reason,
    ).toBe('stale')
    expect(h.rec('sub').status).toBe('active')
    // wrong kind (a task) and unknown step
    expect(
      of(h.child('t', { status: 'done', seq: 1 }, { done: { output: 1 } }), 'result.ignored')[0]
        ?.reason,
    ).toBe('stale')
    expect(h.rec('t').status).toBe('idle')
    expect(of(h.child('ghost', { status: 'done' }), 'result.ignored')[0]?.reason).toBe(
      'unknown-step',
    )
    // the fresh one still works
    const ok = h.child('sub', { status: 'done', seq: 6 }, { done: { output: 'out' } })
    expect(ok.types.slice(0, 2)).toEqual(['child.summary', 'step.done'])
    expect(h.state.status).toBe('done')
  })

  it('two concurrent halt failures: the flow stays failed until every failed step recovers (either retry order); child commands still reach a running child', () => {
    for (const order of [
      ['a', 'b'],
      ['b', 'a'],
    ] as const) {
      const h = createHarness(
        flow({
          start: ['a', 'b', 'sub'],
          steps: {
            a: task({ next: 'end' }),
            b: task({ next: 'end' }),
            sub: flowStep(child, { next: 'end' }),
            end: final({ dependsOn: ['a', 'b', 'sub'] }),
          },
        }),
      )
      h.start()
      h.ok(h.call('childContext'), {})
      h.err(h.call('run', 'a'), 'a broke')
      h.err(h.call('run', 'b'), 'b broke')
      expect(h.state.status).toBe('failed')
      // the still-running child accepts commands while the parent is halt-failed
      const fwd = h.cmd({ type: 'child', path: ['sub'], command: { type: 'next' } })
      expect(fwd.types).toEqual(['child.command'])
      // retry the first: still failed (the other one is failed), scheduling stays frozen
      h.cmd({ type: 'retry', step: order[0] })
      expect(h.state.status).toBe('failed')
      h.ok(h.call('run', order[0]), 'ok')
      expect(h.state.status).toBe('failed')
      expect(h.rec('end').status).toBe('idle')
      // retry the second: recovers
      h.cmd({ type: 'retry', step: order[1] })
      expect(h.state.status).toBe('running')
      h.ok(h.call('run', order[1]), 'ok')
      expect(h.state.status).toBe('running')
      h.child('sub', { status: 'done' }, { done: { output: 1 } })
      expect(h.state.status).toBe('done')
    }
  })
})
