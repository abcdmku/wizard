/**
 * (f) resume with the REAL machine: snapshot mid-wait (deadline + inbox) →
 * `resumeWizardRuntime` on a fresh runtime → epoch + 1, `flow.resumed`, inbox
 * drained before the overdue timer fires; snapshot mid-running-task →
 * `step.failed{kind:'interrupted'}` → `retry` works; nested children restored;
 * a missing child snapshot is re-created through the childContext pipeline.
 */

import { describe, expect, it } from 'vitest'
import { final, flow, flowStep, guard, task, view, wait } from '../../helpers/fixtures'
import { e2e, e2eResume, roundTrip, tick } from './harness'

describe('e2e resume', () => {
  it('mid-wait: inbox drained first, then the overdue timeout fires — but the delivery already completed the step', async () => {
    const def = flow({
      name: 'wait-resume',
      start: 'form',
      events: { hello: guard(() => true) },
      policies: { unmatchedEvents: { buffer: true, ttlMs: 60_000 } },
      steps: {
        form: view({ next: 'w' }),
        w: wait({
          on: { hello: ({ payload }) => ({ done: { got: payload } }) },
          timeout: { afterMs: 1_000, next: 'expired' },
          next: 'ok',
        }),
        ok: final({ output: () => 'ok' }),
        expired: final({ output: () => 'expired' }),
      },
    })
    // Phase 1: reach the wait, buffer nothing yet, snapshot with the deadline armed.
    const a = e2e(def, { now: 1_000 })
    await a.wizard.start()
    await a.wizard.next()
    expect(a.rec('w').deadline).toBe(2_000)
    const snap1 = roundTrip(a.wizard.getSnapshot())
    a.wizard.dispose()

    // Resume much later: the timer is overdue → re-armed for "now" → fires on the next tick.
    const b = e2eResume(def, snap1, { now: 5_000 })
    expect(b.wizard.epoch).toBe(1)
    expect(b.wizard.log()[0]).toMatchObject({ type: 'flow.resumed', fromSeq: (snap1 as any).seq })
    expect(b.wizard.getState().status).toBe('waiting')
    expect(b.sched.pending()).toBe(1)
    b.sched.advance(0)
    expect(b.rec('w')).toMatchObject({ status: 'done', output: { event: 'timeout' } })
    expect(b.wizard.getState().output).toBe('expired')

    // Phase 2: an event arrives EARLY (buffered) while another instance is mid-wait; snapshot; resume
    // overdue → the inbox drains first (the handler completes the wait), the timer is not honoured.
    const c = e2e(def, { now: 1_000, instanceId: 'c' })
    await c.wizard.start()
    // buffer while still on the view (nobody listens)
    expect(await c.wizard.send('hello', { n: 7 })).toMatchObject({ buffered: true })
    // craft the situation "wait active + inbox entry" by editing the snapshot: move to the wait
    await c.wizard.next() // drains the inbox immediately → done. So instead build a snapshot by hand:
    expect(c.wizard.getState().status).toBe('done')
    const d = e2e(def, { now: 1_000, instanceId: 'd' })
    await d.wizard.start()
    await d.wizard.next() // wait active, deadline 2_000, inbox empty
    const base = d.wizard.getSnapshot()
    const inboxSnap = roundTrip({
      ...base,
      state: {
        ...base.state,
        inbox: [{ id: 'evt_x', event: 'hello', payload: { n: 9 }, at: 1_500, expiresAt: 61_500 }],
        timers: {
          ...base.state.timers,
          'inbox:evt_x': {
            at: 61_500,
            fire: { type: 'timer.fired', timerId: 'inbox:evt_x' },
            purpose: 'inboxTtl',
          },
        },
      },
    })
    d.wizard.dispose()
    const e = e2eResume(def, inboxSnap, { now: 5_000 })
    // Drained during the resume batch itself, before any timer could fire.
    expect(e.of('event.delivered')[0]).toMatchObject({ event: 'hello', to: 'w', payload: { n: 9 } })
    expect(e.rec('w')).toMatchObject({ status: 'done', output: { got: { n: 9 } } })
    expect(e.wizard.getState().output).toBe('ok')
    expect(e.wizard.getState().timers).toEqual({})
    e.sched.flush()
    expect(e.wizard.getState().output).toBe('ok')
  })

  it('mid-running task: resumed as step.failed{kind:interrupted}; retry() re-runs it', async () => {
    let calls = 0
    const def = flow({
      name: 'task-resume',
      start: 't',
      steps: {
        t: task({
          run: () => {
            calls += 1
            return calls === 1 ? new Promise(() => {}) : Promise.resolve('second run')
          },
          next: 'end',
        }),
        end: final(),
      },
    })
    const a = e2e(def)
    await a.wizard.start()
    expect(a.rec('t')).toMatchObject({ status: 'active', attempt: 1 })
    const snap = roundTrip(a.wizard.getSnapshot())
    a.wizard.dispose()

    const b = e2eResume(def, snap)
    expect(b.of('flow.resumed')[0]).toMatchObject({ interrupted: ['t'] })
    expect(b.rec('t')).toMatchObject({
      status: 'failed',
      error: { kind: 'interrupted', code: 'INTERRUPTED' },
    })
    expect(b.wizard.getState().status).toBe('failed')
    expect(await b.wizard.retry('t')).toMatchObject({ ok: true })
    await tick()
    expect(b.rec('t')).toMatchObject({ status: 'done', output: 'second run' })
    expect(b.wizard.getState().status).toBe('done')
    expect(calls).toBe(2)
  })

  it('a transaction in flight when persisted is aborted on resume (transition.rejected{resumed})', async () => {
    const def = flow({
      name: 'nav-resume',
      start: 'a',
      steps: { a: view({ canExit: () => new Promise(() => {}), next: 'b' }), b: view() },
    })
    const a = e2e(def)
    await a.wizard.start()
    void a.wizard.next()
    expect(a.wizard.getState().nav.phase).toBe('canExit')
    const snap = roundTrip(a.wizard.getSnapshot())
    a.wizard.dispose()
    const b = e2eResume(def, snap)
    expect(b.of('transition.rejected')[0]).toMatchObject({ reason: 'resumed' })
    expect(b.wizard.getState().nav.phase).toBe('idle')
    expect(b.wizard.getState().current).toBe('a')
  })

  it('nested: children are restored from the snapshot; a missing child snapshot is re-created via childContext', async () => {
    const child = flow({
      name: 'child',
      start: 'v',
      steps: { v: view({ next: 'e' }), e: final({ output: () => 'child done' }) },
    })
    let contextCalls = 0
    const parent = flow({
      name: 'parent',
      start: 'f',
      steps: {
        f: flowStep(child, {
          context: () => {
            contextCalls += 1
            return { n: contextCalls }
          },
          next: 'end',
        }),
        end: final({ output: ({ steps }) => steps.f!.output }),
      },
    })
    const a = e2e(parent)
    await a.wizard.start()
    const childId = a.wizard.child('f').id
    expect(a.wizard.child('f').getState().context).toEqual({ n: 1 })
    const snap = a.wizard.getSnapshot()
    a.wizard.dispose()

    // Restored: same child instance id, epoch bumped, still on its view; finishing it finishes the parent.
    const b = e2eResume(parent, roundTrip(snap))
    const c = b.wizard.child('f')
    expect(c.id).toBe(childId)
    expect(c.epoch).toBe(1)
    expect(c.getState().current).toBe('v')
    expect(contextCalls).toBe(1)
    await c.next()
    expect(b.wizard.getState().status).toBe('done')
    expect(b.wizard.getState().output).toBe('child done')

    // Missing child snapshot: the parent forgets the summary → plan(flow.resumed) calls childContext again.
    const d = e2eResume(parent, roundTrip({ ...snap, children: {} }))
    expect(contextCalls).toBe(2)
    expect(d.of('child.started')[0]).toMatchObject({ step: 'f', context: { n: 2 } })
    const recreated = d.wizard.child('f')
    expect(recreated.epoch).toBe(0) // a fresh instance, not a restored one
    expect(recreated.getState().context).toEqual({ n: 2 })
    expect(recreated.getState().current).toBe('v')
    expect(d.rec('f').child).toMatchObject({ status: 'waiting' })
  })
})
