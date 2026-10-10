/**
 * v0.2 §10.2 — `when` predicates and the `skip` command. Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import { explain, phase, ready } from '../../src/machine/index'
import { createHarness, decision, final, flow, of, replay, task, view } from '../helpers/fixtures'

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

  it('a late when result after done / cancel / compensation is stale (result.ignored, nothing skips or schedules); a terminal snapshot resumes without re-asking', () => {
    // `opt` (pending, `when` in flight once `t` is done) outlives the flow's terminal transition.
    const make = (policies?: { onFailure: 'compensate' }) =>
      createHarness(
        flow({
          start: ['t', 'opt'],
          steps: {
            t: task({ compensate: on, next: 'end' }),
            opt: task({ when: yes, dependsOn: ['t'], next: 'end' }),
            end: final({ dependsOn: ['t', 'opt'] }),
          },
          ...(policies !== undefined ? { policies } : {}),
        }),
      )
    // Done: `a` completes the flow while `opt`'s predicate is still in flight.
    const done = createHarness(
      flow({
        start: ['a', 'opt'],
        steps: {
          a: task({ next: 'end' }),
          opt: task({ when: yes, next: 'end' }),
          end: final(),
        },
      }),
    )
    done.start()
    const whenDone = done.call('when', 'opt')
    done.ok(done.call('run', 'a'), 1)
    expect(done.state.status).toBe('done')
    expect(done.rec('opt').when).toBeUndefined() // token staled by flow.done
    expect(done.ok(whenDone, false).types).toEqual(['result.ignored'])
    expect(done.rec('opt').status).toBe('idle')
    // Cancel.
    const cancelled = make()
    cancelled.start()
    expect(cancelled.rec('opt').when).toBeUndefined() // not eligible yet (dependsOn t)
    cancelled.ok(cancelled.call('run', 't'), 1) // opt eligible → when asked; end pending
    const whenCancelled = cancelled.call('when', 'opt')
    cancelled.cmd({ type: 'cancel', reason: 'stop' })
    expect(cancelled.state.status).toBe('cancelled')
    expect(cancelled.ok(whenCancelled, false).types).toEqual(['result.ignored'])
    expect(cancelled.rec('opt').status).toBe('idle')
    // Compensation (a saga cancel): the flow compensates `t`; the predicate result is stale.
    const saga = make({ onFailure: 'compensate' })
    saga.start()
    saga.ok(saga.call('run', 't'), 1)
    const whenSaga = saga.call('when', 'opt')
    saga.cmd({ type: 'cancel', reason: 'undo' })
    expect(saga.state.status).toBe('compensating')
    expect(saga.ok(whenSaga, true).types).toEqual(['result.ignored'])
    // Resume of a terminal snapshot: no `when` call is re-issued.
    const resumed = done.step({ type: 'resume', fromSeq: done.state.seq })
    expect(resumed.effects.filter((e) => e.kind === 'call')).toEqual([])
    expect(replay(done)).toEqual(done.state)
  })

  it('cursorHint survives an unrelated (background auto-advance) transaction: once the predicate passes the hinted view wins among several ready views', () => {
    const h = createHarness(
      flow({
        start: ['a', 't'],
        steps: {
          a: view({ next: ['b', 'c'] }),
          b: view({ when: yes, next: 'end' }),
          c: view({ next: 'end' }),
          t: task({ next: 'end' }),
          end: final({ dependsOn: ['b', 'c', 't'] }),
        },
      }),
    )
    h.start()
    h.cmd('next') // commits to b without entering it (when pending), c is ready
    expect(h.state.nav.cursorHint).toBe('b')
    const bg = h.ok(h.call('run', 't'), 1) // t's auto-advance arrives `end` — unrelated to the cursor
    expect(of(bg, 'transition.committed')[0]).toMatchObject({ from: 't', cause: 'auto' })
    expect(h.state.nav.cursorHint).toBe('b')
    h.ok(h.call('when', 'b'), true)
    expect(h.state.current).toBe('b')
    expect(h.state.nav.cursorHint).toBeUndefined()
    expect(replay(h)).toEqual(h.state)
  })

  it('go to a visited view whose when is pending: the predicate is staled (late result ignored), not re-asked during the transaction, enter runs only for a view that will enter, and the view enters', () => {
    const h = createHarness(
      flow({
        start: ['a', 't'],
        steps: {
          a: view({ next: 'b' }),
          b: view({ when: yes, enter: on, next: 'c' }),
          c: view({ next: 'b' }),
          t: task(),
        },
      }),
    )
    h.start()
    const first = h.cmd('next') // a → b commits without entering b: `when` first, no `enter` yet
    expect(of(first, 'transition.committed')[0]).toMatchObject({ from: 'a', to: 'b' })
    expect(h.pending('enter', 'b')).toHaveLength(0)
    h.ok(h.call('when', 'b'), true) // → cursor transaction → enter(b)
    h.ok(h.call('enter', 'b'))
    expect(h.state.current).toBe('b')
    h.cmd('next') // b → c
    expect(h.state.current).toBe('c')
    h.cmd('next') // c → b again: b (visited) is arrived, its when is asked, nothing entered
    expect(h.state.current).toBeNull()
    expect(h.rec('b')).toMatchObject({ pendingActivation: true, when: 'pending', visitedCount: 1 })
    const when = h.call('when', 'b')
    // Explicit go to the visited view: allowed, bypasses `when` (the token is staled at once).
    const go = h.cmd({ type: 'go', step: 'b' })
    expect(of(go, 'transition.started')[0]).toMatchObject({ to: 'b', cause: 'go' })
    expect(h.rec('b').when).toBeUndefined()
    expect(h.state.nav.phase).toBe('entering') // async `enter` in flight
    expect(h.ok(when, false).types).toEqual(['result.ignored'])
    // A background completion re-schedules mid-transaction: b's when is NOT asked again.
    h.ok(h.call('run', 't'), 1)
    expect(h.pending('when', 'b')).toHaveLength(0)
    const done = h.ok(h.call('enter', 'b'))
    expect(of(done, 'transition.committed')[0]).toMatchObject({ to: 'b', cause: 'go' })
    expect(h.state.current).toBe('b')
    expect(h.rec('b')).toMatchObject({ status: 'active', visitedCount: 2 })
    expect(replay(h)).toEqual(h.state)
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
