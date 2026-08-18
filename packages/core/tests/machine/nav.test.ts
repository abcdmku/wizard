import { describe, expect, it } from 'vitest'
import {
  createHarness,
  decision,
  final,
  flow,
  guard,
  of,
  task,
  view,
  wait,
} from '../helpers/fixtures'

const linear = () =>
  flow({
    start: 'a',
    steps: {
      a: view({ next: 'b' }),
      b: view({ next: 'c' }),
      c: view({ next: 'end' }),
      end: final(),
    },
  })

describe('nav pipeline — start and hookless next', () => {
  it('start arrives at the start step and the cursor rule enters the single ready view', () => {
    const h = createHarness(linear())
    const r = h.start()
    // the cursor rule is a (lightweight) transaction: canEnter → exiting → entering → commit
    expect(r.types).toEqual([
      'flow.started',
      'step.arrived',
      'transition.started',
      'transition.phase',
      'transition.phase',
      'transition.phase',
      'step.entered',
      'transition.committed',
    ])
    expect(of(r, 'transition.started')[0]).toMatchObject({ from: null, to: 'a', cause: 'start' })
    expect(of(r, 'transition.phase').map((p) => p.phase)).toEqual([
      'canEnter',
      'exiting',
      'entering',
    ])
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: null, to: 'a', cause: 'start' })
    expect(h.state.current).toBe('a')
    expect(h.state.status).toBe('waiting')
    expect(h.state.history).toEqual(['a'])
    expect(h.rec('a')).toMatchObject({
      status: 'active',
      runId: 1,
      visitedCount: 1,
      pendingActivation: false,
    })
    // effects: settle for the cursor-rule commit + persist (no hooks anywhere)
    expect(r.effects.map((e) => e.kind)).toEqual(['settle', 'persist'])
  })

  it('a hookless next produces one batch: started → phases → exited/arrived/entered → committed', () => {
    const h = createHarness(linear())
    h.start()
    const r = h.cmd('next')
    expect(r.types).toEqual([
      'transition.started',
      'transition.phase', // parsingInput (no boundary → trivially validated)
      'step.validated',
      'transition.phase', // validating
      'transition.phase', // canExit
      'transition.phase', // resolvingTarget (targets known)
      'transition.phase', // canEnter
      'transition.phase', // exiting
      'transition.phase', // entering
      'step.exited',
      'step.arrived',
      'step.entered',
      'transition.committed',
    ])
    expect(of(r, 'transition.phase').map((p) => p.phase)).toEqual([
      'parsingInput',
      'validating',
      'canExit',
      'resolvingTarget',
      'canEnter',
      'exiting',
      'entering',
    ])
    expect(h.state.current).toBe('b')
    expect(h.state.history).toEqual(['a', 'b'])
    expect(h.rec('a').status).toBe('done')
    expect(h.state.nav).toEqual({ phase: 'idle', hops: 0 })
    const settle = r.effects.find((e) => e.kind === 'settle')
    expect(settle).toMatchObject({ kind: 'settle', outcome: 'ok', value: { from: 'a', to: 'b' } })
  })

  it('reaching a final ends the flow (step.done + flow.done) and rejects further commands', () => {
    const h = createHarness(linear())
    h.start()
    h.cmd('next')
    h.cmd('next')
    const r = h.cmd('next')
    expect(r.types.slice(-4)).toEqual([
      'transition.committed',
      'step.entered',
      'step.done',
      'flow.done',
    ])
    expect(h.state.status).toBe('done')
    expect(h.state.current).toBeNull()
    expect(h.state.active).toEqual([])
    const rej = h.cmd('next')
    expect(rej.types).toEqual(['transition.rejected'])
    expect(of(rej, 'transition.rejected')[0]?.reason).toBe('flow-terminal')
  })
})

describe('nav pipeline — veto points', () => {
  const withHooks = () =>
    flow({
      start: 'a',
      steps: {
        a: view({
          input: guard((v) => typeof v === 'object' && v !== null && 'name' in v),
          validate: () => undefined,
          canExit: () => true,
          exit: () => undefined,
          next: 'b',
        }),
        b: view({ canEnter: () => true, enter: () => undefined, next: 'end' }),
        end: final(),
      },
    })

  it('parseInput failure → step.validationFailed + transition.rejected{validation} with issues', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd({ type: 'setInput', step: 'a', patch: { name: 'x' } })
    const r = h.cmd('next')
    expect(r.types).toEqual(['transition.started', 'transition.phase'])
    const call = h.call('parseInput')
    expect(call.token).toEqual({ step: 'a', runId: 1, txId: 'tx-2' })
    const res = h.err(call, 'bad', { issues: [{ message: 'name required' }] })
    expect(res.types).toEqual(['step.validationFailed', 'transition.rejected'])
    expect(of(res, 'transition.rejected')[0]).toMatchObject({
      reason: 'validation',
      step: 'a',
      issues: [{ message: 'name required' }],
    })
    expect(h.rec('a').issues).toEqual([{ message: 'name required' }])
    expect(h.state.nav.phase).toBe('idle')
    expect(h.state.current).toBe('a')
    expect(res.effects[0]).toMatchObject({ kind: 'settle', txId: 'tx-2', outcome: 'rejected' })
  })

  it('validate returning issues → rejected; validate ok → canExit call', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    expect(h.rec('a').output).toEqual({ name: 'x' })
    const v = h.call('validate')
    expect(v.extra).toEqual({ input: { name: 'x' } })
    const bad = h.ok(v, [{ message: 'nope' }])
    expect(bad.types).toEqual(['step.validationFailed', 'transition.rejected'])
    // retry: pass validation this time
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    h.ok(h.call('validate'), undefined)
    expect(h.state.nav.phase).toBe('canExit')
    expect(h.pending('canExit')).toHaveLength(1)
  })

  it('canExit false → guardEvaluated{ok:false} + rejected{guard-canExit}; guards are recorded on the step', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    h.ok(h.call('validate'), undefined)
    const r = h.ok(h.call('canExit'), false)
    expect(r.types).toEqual(['step.guardEvaluated', 'transition.rejected'])
    expect(of(r, 'transition.rejected')[0]).toMatchObject({ reason: 'guard-canExit', step: 'a' })
    expect(h.rec('a').guards.canExit).toMatchObject({ ok: false })
  })

  it('canEnter false on the target → rejected{guard-canEnter, step:target}; from stays current', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    h.ok(h.call('validate'), undefined)
    h.ok(h.call('canExit'), true)
    expect(h.state.nav.phase).toBe('canEnter')
    const ce = h.call('canEnter')
    expect(ce).toMatchObject({ step: 'b', extra: { from: 'a' } })
    const r = h.ok(ce, false)
    expect(of(r, 'transition.rejected')[0]).toMatchObject({ reason: 'guard-canEnter', step: 'b' })
    expect(h.rec('b').guards.canEnter?.ok).toBe(false)
    expect(h.state.current).toBe('a')
    expect(h.rec('a').status).toBe('active')
  })

  it('exit hook error → transition.failed; from stays active and nav returns to idle', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    h.ok(h.call('validate'), undefined)
    h.ok(h.call('canExit'), true)
    h.ok(h.call('canEnter'), true)
    expect(h.state.nav.phase).toBe('exiting')
    const r = h.err(h.call('exit'), 'exit blew up')
    expect(r.types).toEqual(['transition.failed'])
    expect(of(r, 'transition.failed')[0]).toMatchObject({
      step: 'a',
      error: { message: 'exit blew up' },
    })
    expect(h.state.nav.phase).toBe('idle')
    expect(h.rec('a').status).toBe('active')
    expect(r.effects[0]).toMatchObject({ kind: 'settle', outcome: 'failed' })
  })

  it('enter hook runs in the entering phase; on success the transition commits without a second enter call', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    h.ok(h.call('validate'), undefined)
    h.ok(h.call('canExit'), true)
    h.ok(h.call('canEnter'), true)
    h.ok(h.call('exit'))
    expect(h.state.nav.phase).toBe('entering')
    const enter = h.call('enter')
    expect(enter).toMatchObject({ step: 'b', token: { step: 'b', runId: 0, txId: 'tx-2' } })
    const r = h.ok(enter)
    expect(r.types).toEqual([
      'step.enterCompleted',
      'step.exited',
      'step.arrived',
      'step.entered',
      'transition.committed',
    ])
    expect(of(r, 'step.entered')[0]?.enterPending).toBeUndefined()
    expect(h.rec('b').enterDone).toBeUndefined() // cleared on entry
    expect(h.pending('enter')).toHaveLength(0)
    expect(h.state.current).toBe('b')
    expect(h.rec('b').entering).toBeUndefined()
  })

  it('enter hook error in the entering phase → transition.failed{step: target}; target not entered', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    h.ok(h.call('parseInput'), { name: 'x' })
    h.ok(h.call('validate'), undefined)
    h.ok(h.call('canExit'), true)
    h.ok(h.call('canEnter'), true)
    h.ok(h.call('exit'))
    const r = h.err(h.call('enter'), 'enter failed')
    expect(of(r, 'transition.failed')[0]?.step).toBe('b')
    expect(h.rec('b').status).toBe('idle')
    expect(h.rec('a').status).toBe('active')
    expect(h.state.current).toBe('a')
  })

  it('nav-busy: a second next during an in-flight transition is rejected with a FRESH txId', () => {
    const h = createHarness(withHooks())
    h.start()
    const first = h.cmd('next')
    const tx = of(first, 'transition.started')[0]?.txId
    const r = h.cmd('next')
    expect(r.types).toEqual(['transition.rejected'])
    const rej = of(r, 'transition.rejected')[0]
    expect(rej?.reason).toBe('nav-busy')
    expect(rej?.txId).not.toBe(tx)
    // the in-flight transaction is untouched
    expect(h.state.nav.txId).toBe(tx)
    expect(h.state.nav.phase).toBe('parsingInput')
  })

  it('setInput on the from view of an in-flight transition is rejected NAV_BUSY; other views are fine', () => {
    const h = createHarness(withHooks())
    h.start()
    h.cmd('next')
    const r = h.cmd({ type: 'setInput', step: 'a', patch: { name: 'late' } })
    expect(of(r, 'command.rejected')[0]).toMatchObject({ code: 'NAV_BUSY' })
    const ok = h.cmd({ type: 'setInput', step: 'b', patch: { x: 1 } })
    expect(ok.types).toEqual(['input.changed'])
    expect(h.rec('b').input).toEqual({ x: 1 })
  })
})

describe('nav pipeline — dynamic next, go, back', () => {
  const branching = () =>
    flow({
      start: 'a',
      steps: {
        a: view({ dynamicNext: () => 'b' }),
        b: view({ next: 'c' }),
        c: view({ next: 'end' }),
        d: view({ next: 'end' }),
        end: final(),
      },
    })

  it('dynamic next: call next{extra.output}, then canEnter → commit; null result → no-target', () => {
    const h = createHarness(branching())
    h.start()
    h.cmd({ type: 'setInput', step: 'a', patch: { v: 1 } })
    h.cmd('next')
    expect(h.state.nav.phase).toBe('resolvingTarget')
    const call = h.call('next')
    expect(call).toMatchObject({ step: 'a', extra: { output: { v: 1 } }, token: { txId: 'tx-2' } })
    const r = h.ok(call, 'c')
    expect(r.types).toEqual([
      'transition.phase', // canEnter (targets set)
      'transition.phase', // exiting
      'transition.phase', // entering
      'step.exited',
      'step.arrived',
      'step.entered',
      'transition.committed',
    ])
    expect(of(r, 'transition.phase')[0]).toMatchObject({ phase: 'canEnter', targets: ['c'] })
    expect(h.state.current).toBe('c')

    // back to a, then a null result rejects with no-target
    h.cmd('back')
    expect(h.state.current).toBe('a')
    h.cmd('next')
    const rej = h.ok(h.call('next'), null)
    expect(of(rej, 'transition.rejected')[0]?.reason).toBe('no-target')
    expect(h.state.current).toBe('a')
  })

  it('dynamic next returning an unknown id → transition.failed{UNKNOWN_STEP}', () => {
    const h = createHarness(branching())
    h.start()
    h.cmd('next')
    const r = h.ok(h.call('next'), 'nope')
    expect(of(r, 'transition.failed')[0]).toMatchObject({
      step: 'a',
      error: { code: 'UNKNOWN_STEP' },
    })
  })

  it('dynamic next hook error → transition.failed', () => {
    const h = createHarness(branching())
    h.start()
    h.cmd('next')
    const r = h.err(h.call('next'), 'kaboom')
    expect(of(r, 'transition.failed')[0]?.error.message).toBe('kaboom')
    expect(h.state.nav.phase).toBe('idle')
  })

  it('go: ready or visited views are reachable; others are not; non-views rejected not-a-view', () => {
    const h = createHarness(branching())
    h.start()
    // d is neither ready nor visited
    expect(of(h.cmd({ type: 'go', step: 'd' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    expect(of(h.cmd({ type: 'go', step: 'end' }), 'transition.rejected')[0]?.reason).toBe(
      'not-a-view',
    )
    expect(of(h.cmd({ type: 'go', step: 'a' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    expect(of(h.cmd({ type: 'go', step: 'zzz' }), 'transition.rejected')[0]?.reason).toBe(
      'not-a-view',
    )
    // move a → b → c, then go back to a visited view (a) via go
    h.cmd('next')
    h.ok(h.call('next'), 'b')
    h.cmd('next')
    expect(h.state.current).toBe('c')
    const r = h.cmd({ type: 'go', step: 'a' })
    expect(of(r, 'transition.started')[0]).toMatchObject({ from: 'c', to: 'a', cause: 'go' })
    expect(of(r, 'transition.committed')[0]).toMatchObject({
      from: 'c',
      to: 'a',
      direction: 'forward',
    })
    expect(h.state.current).toBe('a')
    expect(h.rec('c').status).toBe('done')
    expect(h.state.history).toEqual(['a', 'b', 'c', 'a'])
  })

  it('go from a null cursor runs only canEnter → exiting → entering', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['b', 'c'] }),
          b: view({ next: 'end' }),
          c: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next') // fan-out: b becomes current, c stays ready
    expect(h.state.current).toBe('b')
    expect(h.rec('c')).toMatchObject({ pendingActivation: true, status: 'idle' })
    const r = h.cmd({ type: 'go', step: 'c' })
    expect(h.state.current).toBe('c')
    expect(of(r, 'transition.phase').map((p) => p.phase)).toEqual([
      'parsingInput',
      'validating',
      'canExit',
      'resolvingTarget',
      'canEnter',
      'exiting',
      'entering',
    ])
    expect(h.rec('b').status).toBe('done')
  })

  it('back: previous view in history; from → idle (kept input), history pops, no parse/validate/canExit', () => {
    const h = createHarness(linear())
    h.start()
    h.cmd({ type: 'setInput', step: 'a', patch: { n: 1 } })
    h.cmd('next')
    h.cmd({ type: 'setInput', step: 'b', patch: { m: 2 } })
    h.cmd('next')
    expect(h.state.history).toEqual(['a', 'b', 'c'])
    const r = h.cmd('back')
    expect(of(r, 'transition.started')[0]).toMatchObject({ from: 'c', to: 'b', cause: 'back' })
    expect(of(r, 'transition.phase').map((p) => p.phase)).toEqual([
      'canEnter',
      'exiting',
      'entering',
    ])
    expect(of(r, 'step.exited')[0]).toMatchObject({ step: 'c', to: 'b', direction: 'back' })
    expect(h.rec('c').status).toBe('idle')
    expect(h.state.current).toBe('b')
    expect(h.state.history).toEqual(['a', 'b'])
    expect(h.rec('b')).toMatchObject({
      status: 'active',
      input: { m: 2 },
      visitedCount: 2,
      runId: 2,
    })
    // back again to a, then no more history
    h.cmd('back')
    expect(h.state.current).toBe('a')
    expect(of(h.cmd('back'), 'transition.rejected')[0]?.reason).toBe('no-history')
  })

  it('back runs canEnter on the previous view and exit on the current one', () => {
    const calls: string[] = []
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ canEnter: () => true, next: 'b' }),
          b: view({ exit: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('canEnter'), true) // the cursor rule (start) evaluates a's canEnter too
    h.cmd('next')
    h.cmd('back')
    expect(h.state.nav.phase).toBe('canEnter')
    const ce = h.call('canEnter')
    calls.push(ce.step)
    h.ok(ce, true)
    expect(h.state.nav.phase).toBe('exiting')
    const ex = h.call('exit')
    expect(ex).toMatchObject({ step: 'b', extra: { to: 'a', direction: 'back' } })
    h.ok(ex)
    expect(calls).toEqual(['a'])
    expect(h.state.current).toBe('a')
    expect(h.rec('b').status).toBe('idle')
  })

  it('go to a view whose deps are unmet is not reachable (explainable), and becomes reachable when they are met', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t', 'b'] }),
          t: task(),
          b: view({ dependsOn: ['t'], next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    // b arrived but blocked on t; cursor is null; t is running
    expect(h.state.current).toBeNull()
    expect(h.rec('b')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(of(h.cmd({ type: 'go', step: 'b' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    // t completes → b ready → cursor rule moves there automatically
    const r = h.ok(h.call('run'), 1)
    expect(h.state.current).toBe('b')
    expect(of(r, 'transition.committed').at(-1)).toMatchObject({
      from: null,
      to: 'b',
      cause: 'auto',
    })
  })
})

describe('fan-out atomicity and cursor rules', () => {
  it("one target's canEnter false rejects the whole fan-out (no target arrives)", () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['b', 'c', 'd'] }),
          b: task({ canEnter: () => true }),
          c: view({ canEnter: () => true, next: 'end' }),
          d: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    expect(h.state.nav.pendingSteps).toEqual(['b', 'c'])
    const calls = h.pending('canEnter')
    expect(calls.map((c) => c.step)).toEqual(['b', 'c'])
    h.ok(calls[0]!, true)
    expect(h.state.nav.pendingSteps).toEqual(['c'])
    const r = h.ok(calls[1]!, false)
    expect(of(r, 'transition.rejected')[0]).toMatchObject({ reason: 'guard-canEnter', step: 'c' })
    for (const id of ['b', 'c', 'd']) expect(h.rec(id).pendingActivation).toBe(false)
    expect(h.state.current).toBe('a')
    expect(h.state.active).toEqual(['a'])
  })

  it('all canEnter ok → every target arrives; tasks run in parallel; the first view becomes current', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t1', 'v1', 't2', 'v2'] }),
          t1: task({ canEnter: () => true }),
          t2: task(),
          v1: view({ next: 'end' }),
          v2: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const r = h.ok(h.call('canEnter'), true)
    expect(of(r, 'step.arrived').map((e) => e.step)).toEqual(['t1', 'v1', 't2', 'v2'])
    expect(h.state.current).toBe('v1')
    expect(h.state.active).toEqual(['v1', 't1', 't2'])
    expect(h.rec('v2')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(h.pending('run').map((c) => c.step)).toEqual(['t1', 't2'])
    expect(h.state.status).toBe('running')
  })

  it('cursor rule: with several ready views and no cursor, current stays null (candidates listed by explain)', () => {
    const h = createHarness(
      flow({
        start: ['t'],
        steps: {
          t: task({ next: ['v1', 'v2'] }),
          v1: view({ next: 'end' }),
          v2: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    expect(h.state.current).toBeNull()
    const r = h.ok(h.call('run'), 'ok')
    // auto-advance from t: fan-out to two views; the first view (v1) becomes current
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: 't', to: 'v1', cause: 'auto' })
    expect(h.state.current).toBe('v1')
    expect(h.rec('v2').pendingActivation).toBe(true)
  })

  it('auto-advance chains through non-view steps and stops on a view; hops reset by user commands', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 't1' }),
          t1: task({ next: 't2' }),
          t2: task({ next: 'v' }),
          v: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    expect(h.state.current).toBeNull()
    expect(h.state.status).toBe('running')
    h.ok(h.call('run', 't1'), 1)
    expect(h.state.nav.hops).toBe(1)
    expect(h.pending('run', 't2')).toHaveLength(1)
    const r = h.ok(h.call('run', 't2'), 2)
    expect(h.state.nav.hops).toBe(2)
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: 't2', to: 'v', cause: 'auto' })
    expect(h.state.current).toBe('v')
    expect(h.state.history).toEqual(['a', 'v'])
    h.cmd('next')
    expect(h.state.status).toBe('done')
  })

  it('AUTO_ADVANCE_LOOP: a decision cycle fails the flow after 1000 hops', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: decision({ decide: () => 'b' }),
          b: decision({ decide: () => 'a' }),
        },
      }),
    )
    h.start()
    let hops = 0
    let last = h.state
    for (let i = 0; i < 1100; i++) {
      const pending = h.pending('next')
      const call = pending[pending.length - 1]
      if (call === undefined) break
      const target = call.step === 'a' ? 'b' : 'a'
      const r = h.ok(call, target)
      last = r.state
      hops++
      if (r.types.includes('flow.failed')) break
    }
    expect(last.status).toBe('failed')
    expect(of(h.log, 'flow.failed')[0]?.code).toBe('AUTO_ADVANCE_LOOP')
    expect(hops).toBeGreaterThan(999)
    expect(hops).toBeLessThan(1010)
  })

  it('hops restart at every external message: a send-driven wait/task loop never trips the guard', () => {
    const h = createHarness(
      flow({
        start: 'w',
        steps: {
          w: wait({ on: { tick: () => undefined }, next: 't' }),
          t: task({ next: 'w' }),
        },
      }),
    )
    h.start()
    for (let i = 0; i < 1200; i++) {
      h.cmd({ type: 'send', event: 'tick', payload: i })
      h.ok(h.call('on'), undefined)
      h.ok(h.call('run'), i)
    }
    expect(h.state.status).toBe('waiting')
    expect(h.state.nav.hops).toBe(2) // w → t → w since the last send
    expect(h.log.some((e) => e.type === 'flow.failed')).toBe(false)
  })

  it('a non-view completion while a transition is in flight is deferred until nav idles', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t', 'v'] }),
          t: task({ next: 'joined' }),
          v: view({ canExit: () => true, next: 'w' }),
          w: view({ next: 'end' }),
          joined: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next') // t runs, v is current
    h.cmd('next') // v → parsing…canExit (async)
    expect(h.state.nav.phase).toBe('canExit')
    const r = h.ok(h.call('run', 't'), 'x')
    expect(r.types).toEqual(['step.runSucceeded', 'step.done'])
    expect(h.state.nav.deferred).toEqual([{ step: 't' }])
    // the user transition finishes; the deferred auto-advance runs right after the commit
    const c = h.ok(h.call('canExit'), true)
    const started = of(c, 'transition.started')
    expect(started.map((s) => s.cause)).toEqual(['auto'])
    expect(started[0]?.from).toBe('t')
    expect(h.state.nav.deferred).toBeUndefined()
    expect(h.rec('joined').pendingActivation).toBe(true)
    expect(h.state.current).toBe('w')
  })
})

describe('review follow-ups — atomic multi-target entry, go after back', () => {
  it('next() to a task whose enter hook fails: no commit, no successful settle, from stays current', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 't' }),
          t: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const r = h.cmd('next')
    expect(r.types).not.toContain('transition.committed')
    expect(h.state.nav.phase).toBe('entering')
    expect(h.state.nav.pendingSteps).toEqual(['t'])
    expect(h.rec('t').entering).toBe(true)
    expect(r.effects.filter((e) => e.kind === 'settle')).toEqual([])
    const enter = h.call('enter')
    expect(enter).toMatchObject({ step: 't', token: { step: 't', runId: 0 } })
    expect(enter.token.txId).toBeDefined()
    const failed = h.err(enter, 'cannot enter task')
    expect(failed.types).toEqual(['transition.failed'])
    expect(of(failed, 'transition.failed')[0]).toMatchObject({
      step: 't',
      error: { message: 'cannot enter task' },
    })
    expect(failed.effects[0]).toMatchObject({ kind: 'settle', outcome: 'failed' })
    expect(h.state.current).toBe('a')
    expect(h.rec('a').status).toBe('active')
    expect(h.rec('t')).toMatchObject({ status: 'idle', pendingActivation: false, visitedCount: 0 })
    expect(h.rec('t').entering).toBeUndefined()
    expect(h.state.status).toBe('waiting')
    expect(h.pending('run')).toHaveLength(0)
  })

  it('next() to a task whose enter succeeds: commit, then the run starts without a second enter call', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 't' }),
          t: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const r = h.ok(h.call('enter'))
    expect(r.types).toEqual([
      'step.enterCompleted',
      'step.exited',
      'step.arrived',
      'transition.committed',
      'step.entered',
      'step.runStarted',
    ])
    expect(of(r, 'step.entered')[0]?.enterPending).toBeUndefined()
    expect(h.pending('enter')).toHaveLength(0)
    expect(h.pending('run', 't')).toHaveLength(1)
    expect(h.rec('t')).toMatchObject({ status: 'active', runId: 1, attempt: 1 })
    expect(h.rec('t').enterDone).toBeUndefined()
  })

  it('fan-out with several enter hooks: all must resolve before commit; a late failure enters nothing', () => {
    const mk = () =>
      createHarness(
        flow({
          start: 'a',
          steps: {
            a: view({ next: ['t', 'v', 'w'] }),
            t: task({ enter: () => undefined }),
            v: view({ enter: () => undefined, next: 'end' }),
            w: view({ next: 'end' }),
            end: final(),
          },
        }),
      )
    const ok = mk()
    ok.start()
    ok.cmd('next')
    expect(ok.state.nav.pendingSteps).toEqual(['t', 'v'])
    const [enterT, enterV] = ok.pending('enter')
    expect(ok.ok(enterT!).types).toEqual(['step.enterCompleted'])
    expect(ok.state.nav.phase).toBe('entering')
    expect(ok.rec('t').enterDone).toBe(true)
    const committed = ok.ok(enterV!)
    expect(committed.types).toContain('transition.committed')
    expect(ok.state.current).toBe('v')
    expect(ok.state.active).toEqual(['v', 't'])
    expect(ok.pending('enter')).toHaveLength(0)
    expect(ok.rec('w').pendingActivation).toBe(true)

    const late = mk()
    late.start()
    late.cmd('next')
    const [t2, v2] = late.pending('enter')
    late.ok(t2!)
    const r = late.err(v2!, 'v refused')
    expect(r.types).toEqual(['transition.failed'])
    expect(of(r, 'transition.failed')[0]?.step).toBe('v')
    for (const id of ['t', 'v', 'w']) {
      expect(late.rec(id).status, id).toBe('idle')
      expect(late.rec(id).pendingActivation, id).toBe(false)
      expect(late.rec(id).enterDone, id).toBeUndefined()
      expect(late.rec(id).entering, id).toBeUndefined()
    }
    expect(late.state.current).toBe('a')
    expect(late.state.active).toEqual(['a'])
  })

  it('auto-advance targets (from a completed task) still enter through the scheduler sub-phase', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ next: 'u' }),
          u: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const r = h.ok(h.call('run', 't'), 1)
    expect(r.types).toContain('transition.committed')
    expect(of(r, 'step.entered').at(-1)).toMatchObject({ step: 'u', enterPending: true })
    const done = h.ok(h.call('enter'))
    expect(done.types).toEqual(['step.enterCompleted', 'step.runStarted'])
    // a scheduler-entry enter failure fails the step (policy), not a transaction
    const h2 = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ next: 'u' }),
          u: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h2.start()
    h2.ok(h2.call('run', 't'), 1)
    expect(h2.err(h2.call('enter'), 'no').types).toEqual(['step.failed', 'flow.failed'])
  })

  it('A → B → C → back to B → go(C): C is reachable because it was visited (history is only the back-stack)', () => {
    const h = createHarness(linear())
    h.start()
    h.cmd('next')
    h.cmd('next')
    expect(h.state.current).toBe('c')
    h.cmd('back')
    expect(h.state.current).toBe('b')
    expect(h.state.history).toEqual(['a', 'b'])
    const r = h.cmd({ type: 'go', step: 'c' })
    expect(r.types).toContain('transition.committed')
    expect(h.state.current).toBe('c')
    expect(h.state.history).toEqual(['a', 'b', 'c'])
    expect(h.rec('c').visitedCount).toBe(2)
  })
})
