/**
 * v0.2 §10.2 — the `skip` command. Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, final, flow, of, replay, task, view, wait } from '../helpers/fixtures'

const yes = () => true
const on = () => undefined

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
