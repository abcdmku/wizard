/**
 * Navigation pipeline (§1) — start, hookless `next`, and every veto point of a transaction.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, final, flow, guard, of, view } from '../helpers/fixtures'

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
