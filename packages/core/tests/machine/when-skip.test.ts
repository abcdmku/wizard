/**
 * v0.2 §10.2 — `when` predicates and the `skip` command. Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import { explain, phase, ready } from '../../src/machine/index'
import {
  createHarness,
  decision,
  final,
  flow,
  of,
  replay,
  task,
  view,
  wait,
} from '../helpers/fixtures'

const yes = () => true
const on = () => undefined

describe('when — evaluated at readiness', () => {
  it('false skips the step: step.whenStarted → call when → step.whenEvaluated{ok:false} + step.skipped{when}; deps satisfied, next arrived (auto), cursor never lands on it', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 'b' }),
          b: view({ when: yes, exit: on, next: 'c' }),
          c: view({ dependsOn: ['b'], next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const r = h.cmd('next')
    // the transition commits without entering b (its `when` is unevaluated), then asks
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: 'a', to: 'b', cause: 'next' })
    expect(r.types.at(-1)).toBe('step.whenStarted')
    expect(h.rec('b')).toMatchObject({ status: 'idle', pendingActivation: true, when: 'pending' })
    expect(h.state.current).toBeNull()
    expect(ready(h.def, h.state, 'b')).toBe(false)
    expect(phase(h.def, h.state, 'b')).toBe('blocked')
    expect(explain(h.def, h.state, 'b').reasons).toEqual(['when-pending'])
    const call = h.call('when', 'b')
    expect(call.token).toEqual({ step: 'b', runId: 0 })
    const s = h.ok(call, false)
    expect(s.types.slice(0, 4)).toEqual([
      'step.whenEvaluated',
      'step.skipped',
      'transition.started',
      'transition.phase',
    ])
    expect(of(s, 'step.skipped')[0]).toMatchObject({ step: 'b', reason: 'when' })
    expect(of(s, 'transition.started')[0]).toMatchObject({ from: 'b', cause: 'auto' })
    expect(of(s, 'transition.started')[0]).not.toHaveProperty('to')
    // b's exit hook never ran; c (dependsOn b) is satisfied and became current
    expect(h.pending('exit')).toHaveLength(0)
    expect(h.rec('b')).toMatchObject({ status: 'skipped', skipReason: 'when' })
    expect(h.rec('b').when).toBeUndefined()
    expect(h.state.current).toBe('c')
    expect(h.state.history).toEqual(['a', 'c'])
    expect(explain(h.def, h.state, 'b').reasons).toEqual(['not-activated', 'skipped:when'])
    expect(replay(h)).toEqual(h.state)
  })

  it('true lets the step enter: step.whenEvaluated{ok:true} → the cursor rule moves there (cause auto)', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: { a: view({ next: 'b' }), b: view({ when: yes, next: 'end' }), end: final() },
      }),
    )
    h.start()
    h.cmd('next')
    const call = h.call('when', 'b')
    const r = h.ok(call, true)
    expect(r.types).toEqual([
      'step.whenEvaluated',
      'transition.started',
      'transition.phase',
      'transition.phase',
      'transition.phase',
      'step.entered',
      'transition.committed',
    ])
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: null, to: 'b', cause: 'auto' })
    expect(h.state.current).toBe('b')
    expect(h.rec('b').when).toBeUndefined() // cleared on entry
    // a duplicate / stale `when` result for the entered step is ignored (runId moved on)
    const stale = h.step({
      type: 'res.ok',
      effectId: call.effectId,
      hook: 'when',
      token: call.token,
      value: false,
      durationMs: 0,
    })
    expect(stale.types).toEqual(['result.ignored'])
    expect(replay(h)).toEqual(h.state)
  })

  it('a task with when: false is skipped before it ever runs; its dependents proceed; the concurrency budget is untouched', () => {
    let calls = 0
    const h = createHarness(
      flow({
        start: ['t1', 'opt'],
        steps: {
          t1: task({ next: 'join' }),
          opt: task({
            when: () => {
              calls += 1
              return false
            },
            next: 'join',
          }),
          join: task({ dependsOn: ['t1', 'opt'], next: 'end' }),
          end: final(),
        },
        policies: { concurrency: 1 },
      }),
    )
    const r = h.start()
    expect(of(r, 'step.entered').map((e) => e.step)).toEqual(['t1'])
    expect(of(r, 'step.whenStarted').map((e) => e.step)).toEqual(['opt'])
    const s = h.ok(h.call('when', 'opt'), false)
    expect(of(s, 'step.skipped')[0]).toMatchObject({ step: 'opt', reason: 'when' })
    expect(h.pending('run', 'opt')).toHaveLength(0)
    expect(h.rec('join').pendingActivation).toBe(true) // arrived by opt's next
    h.ok(h.call('run', 't1'), 1)
    expect(h.rec('join').status).toBe('active')
    h.ok(h.call('run', 'join'), 2)
    expect(h.state.status).toBe('done')
    expect(calls).toBe(0) // the harness answers the call; the hook itself is data here
  })

  it('a throwing when predicate fails the step (kind hook) and the failure policy applies', () => {
    const h = createHarness(
      flow({ start: 't', steps: { t: task({ when: yes, next: 'end' }), end: final() } }),
    )
    h.start()
    const r = h.err(h.call('when', 't'), 'predicate bug')
    expect(r.types).toEqual(['step.failed', 'flow.failed'])
    expect(h.rec('t')).toMatchObject({ status: 'failed', error: { kind: 'hook' } })
  })

  it('a skipped decision resolves its next hook (call next) to find where to go; a skipped step with next: none stops', () => {
    const h = createHarness(
      flow({
        start: 'd',
        steps: {
          d: decision({ when: yes, decide: () => 'x' }),
          x: final(),
          y: final(),
        },
      }),
    )
    h.start()
    const r = h.ok(h.call('when', 'd'), false)
    expect(r.types).toEqual([
      'step.whenEvaluated',
      'step.skipped',
      'transition.started',
      'transition.phase',
    ])
    const next = h.call('next', 'd')
    expect(next.token.txId).toBeDefined()
    h.ok(next, 'y')
    expect(h.rec('y').status).toBe('done')
    expect(h.rec('x').status).toBe('idle')
    expect(h.state.status).toBe('done')

    const stop = createHarness(
      flow({
        start: ['t', 'v'],
        steps: { t: task({ when: yes }), v: view(), end: final({ dependsOn: ['t'] }) },
      }),
    )
    stop.start()
    const s = stop.ok(stop.call('when', 't'), false)
    expect(s.types).toEqual(['step.whenEvaluated', 'step.skipped'])
    expect(stop.state.current).toBe('v')
  })

  it('cursor rule waits for pending view predicates; among several ready views the transition target (cursor hint) wins', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['b', 'c'] }),
          b: view({ when: yes, next: 'end' }),
          c: view({ next: 'end' }),
          // fan-out branches join into the final (plan §8.3) — a skipped b counts as done
          end: final({ dependsOn: ['b', 'c'] }),
        },
      }),
    )
    h.start()
    const r = h.cmd('next')
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: 'a', to: 'b' })
    expect(h.state.current).toBeNull()
    expect(h.state.nav.cursorHint).toBe('b')
    // c is ready but the cursor rule waits for b's predicate
    expect(ready(h.def, h.state, 'c')).toBe(true)
    const t = h.ok(h.call('when', 'b'), true)
    expect(of(t, 'transition.committed')[0]).toMatchObject({ from: null, to: 'b', cause: 'auto' })
    expect(h.state.current).toBe('b')
    expect(h.state.nav.cursorHint).toBeUndefined()
    expect(ready(h.def, h.state, 'c')).toBe(true) // reachable via go
    expect(replay(h)).toEqual(h.state)

    // false → b skipped, c is the only ready view → cursor moves there
    const g = createHarness(h.def)
    g.start()
    g.cmd('next')
    g.ok(g.call('when', 'b'), false)
    expect(g.state.current).toBe('c')
    expect(g.state.nav.cursorHint).toBeUndefined()
  })

  it('go / back to a visited view bypasses when (explicit navigation); go to a ready view with a pending when is not reachable', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 'b' }),
          b: view({ when: yes, next: 'c' }),
          c: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    expect(of(h.cmd({ type: 'go', step: 'b' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    h.ok(h.call('when', 'b'), true)
    expect(h.state.current).toBe('b')
    h.cmd('next') // → c
    expect(h.state.current).toBe('c')
    // back to b: entered without asking `when` again
    const back = h.cmd('back')
    expect(of(back, 'transition.committed')[0]).toMatchObject({ to: 'b', cause: 'back' })
    expect(h.pending('when', 'b')).toHaveLength(0)
    expect(h.state.current).toBe('b')
  })

  it('resume re-issues an in-flight when predicate', () => {
    const h = createHarness(
      flow({ start: 't', steps: { t: task({ when: yes, next: 'end' }), end: final() } }),
    )
    h.start()
    expect(h.rec('t').when).toBe('pending')
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['flow.resumed'])
    expect(r.effects.filter((e) => e.kind === 'call')).toMatchObject([{ hook: 'when', step: 't' }])
  })
})

describe('skip command', () => {
  const dag = () =>
    flow({
      start: 'v',
      steps: {
        v: view({ canExit: yes, exit: on, next: ['t', 'w'] }),
        t: task({ next: 'join' }),
        w: wait({ on: { e: on }, timeout: { afterMs: 1_000, next: 'join' }, next: 'join' }),
        join: task({ dependsOn: ['t', 'w'], next: 'end' }),
        end: final(),
      },
    })

  it('an active task is cancelled first (run aborted, late result ignored), then skipped; deps count it as done', () => {
    const h = createHarness(dag())
    h.start()
    h.cmd('next')
    h.ok(h.call('canExit'), true)
    h.ok(h.call('exit'))
    const run = h.call('run', 't')
    const r = h.cmd({ type: 'skip', step: 't', reason: 'not needed' })
    expect(r.types).toEqual([
      'step.cancelled',
      'step.skipped',
      'transition.started',
      'transition.phase',
      'transition.phase',
      'transition.phase',
      'transition.phase',
      'step.arrived',
      'transition.committed',
    ])
    expect(of(r, 'step.cancelled')[0]).toMatchObject({ step: 't', reason: 'not needed' })
    expect(of(r, 'step.skipped')[0]).toMatchObject({ step: 't', reason: 'command' })
    expect(h.rec('t')).toMatchObject({ status: 'skipped', skipReason: 'command' })
    expect(h.ok(run, 'late').types).toEqual(['result.ignored'])
    // the wait: skipping clears its timeout timer
    expect(h.state.timers['wait:w']).toBeDefined()
    const s = h.cmd({ type: 'skip', step: 'w' })
    expect(s.types.slice(0, 3)).toEqual(['timer.cleared', 'step.cancelled', 'step.skipped'])
    expect(h.state.timers['wait:w']).toBeUndefined()
    expect(h.rec('join').status).toBe('active') // both deps "done"
    h.ok(h.call('run', 'join'), 1)
    expect(h.state.status).toBe('done')
    expect(replay(h)).toEqual(h.state)
  })

  it('a ready (pending, budget-limited) task is skipped without entering; final / unknown / not-ready / done steps are rejected', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'end' }),
          t2: task({ next: 'end' }),
          later: task({ next: 'end' }),
          end: final({ dependsOn: ['t1', 't2'] }),
        },
        policies: { concurrency: 1 },
      }),
    )
    h.start()
    expect(h.rec('t2')).toMatchObject({ status: 'idle', pendingActivation: true })
    const r = h.cmd({ type: 'skip', step: 't2' })
    expect(r.types.slice(0, 1)).toEqual(['step.skipped'])
    expect(h.rec('t2').status).toBe('skipped')
    expect(of(h.cmd({ type: 'skip', step: 'end' }), 'command.rejected')[0]).toMatchObject({
      code: 'INVALID_COMMAND',
      reason: 'final-step',
    })
    expect(of(h.cmd({ type: 'skip', step: 'nope' }), 'command.rejected')[0]?.code).toBe(
      'UNKNOWN_STEP',
    )
    expect(of(h.cmd({ type: 'skip', step: 'later' }), 'command.rejected')[0]).toMatchObject({
      code: 'NOT_ACTIVE',
      reason: 'not-skippable:idle',
    })
    expect(of(h.cmd({ type: 'skip', step: 't2' }), 'command.rejected')[0]).toMatchObject({
      code: 'NOT_ACTIVE',
      reason: 'not-skippable:skipped',
    })
    h.ok(h.call('run', 't1'), 1)
    expect(h.state.status).toBe('done')
  })

  it('the current view may be skipped (no validation, no exit hook, cursor moves on); not while a transition is in flight from it', () => {
    const h = createHarness(dag())
    h.start()
    h.cmd('next') // canExit pending
    expect(of(h.cmd({ type: 'skip', step: 'v' }), 'command.rejected')[0]).toMatchObject({
      code: 'NAV_BUSY',
    })
    h.ok(h.call('canExit'), false) // rejected → idle again
    const r = h.cmd({ type: 'skip', step: 'v' })
    expect(r.types.slice(0, 2)).toEqual(['step.skipped', 'transition.started'])
    expect(h.pending('exit')).toHaveLength(0)
    expect(h.rec('v').status).toBe('skipped')
    expect(h.state.current).toBeNull()
    expect(h.state.active).toEqual(['t', 'w'])
    expect(replay(h)).toEqual(h.state)
  })

  it('skipping a step whose when is pending discards the predicate result; a skipped step re-arrived later asks when again', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ next: 't' }),
          t: task({ when: yes, next: 'v2' }),
          v2: view({ next: 't' }),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const when = h.call('when', 't')
    h.cmd({ type: 'skip', step: 't' })
    expect(h.rec('t').status).toBe('skipped')
    expect(h.ok(when, false).types).toEqual(['result.ignored'])
    expect(h.state.current).toBe('v2')
    // loop back through t: arrived again → when asked again
    const r = h.cmd('next')
    expect(of(r, 'step.whenStarted')[0]?.step).toBe('t')
    expect(h.rec('t')).toMatchObject({
      status: 'skipped',
      pendingActivation: true,
      when: 'pending',
    })
    h.ok(h.call('when', 't'), true)
    expect(h.rec('t').status).toBe('active')
    expect(replay(h)).toEqual(h.state)
  })

  it('a step skipped while a transition is in flight continues once nav is idle again (nav.deferred, like step.done)', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ canExit: yes, next: ['slow', 'w'] }),
          slow: task({ next: 'w2' }),
          w: view({ canExit: yes, next: 'end' }),
          w2: view({ next: 'end' }),
          end: final({ dependsOn: ['w', 'w2'] }),
        },
      }),
    )
    h.start()
    h.cmd('next')
    h.ok(h.call('canExit', 'v'), true) // slow runs, w current
    expect(h.state.current).toBe('w')
    h.cmd('next') // w's canExit pending → nav busy
    const r = h.cmd({ type: 'skip', step: 'slow' })
    expect(r.types).toEqual(['step.cancelled', 'step.skipped'])
    expect(h.state.nav.deferred).toEqual([{ step: 'slow' }])
    // the transition is rejected → idle → the deferred continuation arrives w2
    const idle = h.ok(h.call('canExit', 'w'), false)
    expect(of(idle, 'transition.started')[0]).toMatchObject({ from: 'slow', cause: 'auto' })
    expect(h.rec('w2')).toMatchObject({ status: 'idle', pendingActivation: true }) // ready, w is current
    expect(h.state.nav.deferred).toBeUndefined()
    expect(replay(h)).toEqual(h.state)
  })
})
