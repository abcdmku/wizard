/**
 * (f) resume with the real machine: snapshot during `waitFor` (deadline + inbox) →
 * `resumeWizardRuntime` on a fresh runtime → epoch + 1, `flow.resumed`, inbox
 * drained before the overdue timer fires; snapshot mid-running-task →
 * `step.failed{kind:'interrupted'}` → `retry` works; nested children restored;
 * a missing child snapshot is re-created through the childContext pipeline.
 */

import { describe, expect, it } from 'vitest'
import {
  eventStep,
  flow,
  flowStep,
  guard,
  routingStep,
  runStep,
  view,
} from '../../helpers/fixtures'
import { e2e, e2eResume, roundTrip, tick } from './harness'

describe('e2e resume', () => {
  it('mid-wait: an overdue timeout fires during the resume batch, before any buffered event is delivered (D9)', async () => {
    const def = flow({
      name: 'wait-resume',
      start: 'form',
      events: { hello: guard(() => true) },
      policies: { unmatchedEvents: { buffer: true, ttlMs: 60_000 } },
      steps: {
        form: view({ next: 'w' }),
        w: eventStep({
          on: { hello: ({ payload }) => ({ done: { got: payload } }) },
          timeout: { afterMs: 1_000, next: 'expired' },
          next: 'ok',
        }),
        ok: runStep({ run: () => 'ok' }),
        expired: runStep({ run: () => 'expired' }),
      },
    })
    // Phase 1: reach the wait, buffer nothing yet, snapshot with the deadline armed.
    const a = e2e(def, { now: 1_000 })
    await a.run.start()
    await a.run.next()
    expect(a.rec('w').deadline).toBe(2_000)
    const snap1 = roundTrip(a.run.getSnapshot())
    a.run.dispose()

    // Resume much later: deadlines are absolute, so the overdue timeout fires in the resume batch.
    const b = e2eResume(def, snap1, { now: 5_000 })
    expect(b.run.epoch).toBe(1)
    expect(b.run.log()[0]).toMatchObject({ type: 'flow.resumed', fromSeq: (snap1 as any).seq })
    expect(b.rec('w')).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(b.rec('ok')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(b.run.getState().output).toBe('expired')
    expect(b.sched.pending()).toBe(0)

    // Phase 2: an event is buffered while another instance is mid-wait; snapshot; resume after the
    // deadline → the overdue timeout fires before the inbox drains, so the timeout wins.
    const c = e2e(def, { now: 1_000, instanceId: 'c' })
    await c.run.start()
    // buffer while still on the view (nobody listens)
    expect(await c.run.send('hello', { n: 7 })).toMatchObject({ buffered: true })
    // craft the situation "wait active + inbox entry" by editing the snapshot: move to the wait
    await c.run.next() // drains the inbox immediately → done. So instead build a snapshot by hand:
    expect(c.run.getState().status).toBe('done')
    const d = e2e(def, { now: 1_000, instanceId: 'd' })
    await d.run.start()
    await d.run.next() // wait active, deadline 2_000, inbox empty
    const base = d.run.getSnapshot()
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
    d.run.dispose()
    const e = e2eResume(def, inboxSnap, { now: 5_000 })
    expect(e.of('event.delivered')).toEqual([])
    expect(e.rec('w')).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(e.run.getState().output).toBe('expired')
  })

  it('mid-running task: resumed as step.failed{kind:interrupted}; retry() re-runs it', async () => {
    let calls = 0
    const def = flow({
      name: 'task-resume',
      start: 't',
      steps: {
        t: runStep({
          run: () => {
            calls += 1
            return calls === 1 ? new Promise(() => {}) : Promise.resolve('second run')
          },
          next: 'end',
        }),
        end: routingStep(),
      },
    })
    const a = e2e(def)
    await a.run.start()
    expect(a.rec('t')).toMatchObject({ status: 'active', attempt: 1 })
    const snap = roundTrip(a.run.getSnapshot())
    a.run.dispose()

    const b = e2eResume(def, snap)
    expect(b.of('flow.resumed')[0]).toMatchObject({ interrupted: ['t'] })
    expect(b.rec('t')).toMatchObject({
      status: 'failed',
      error: { kind: 'interrupted', code: 'INTERRUPTED' },
    })
    expect(b.run.getState().status).toBe('halted')
    expect(await b.run.retry('t')).toMatchObject({ ok: true })
    await tick()
    expect(b.rec('t')).toMatchObject({ status: 'done', output: 'second run' })
    expect(b.run.getState().status).toBe('done')
    expect(calls).toBe(2)
  })

  it('a transaction in flight when persisted is aborted on resume (transition.rejected{resumed})', async () => {
    const def = flow({
      name: 'nav-resume',
      start: 'a',
      steps: { a: view({ canExit: () => new Promise(() => {}), next: 'b' }), b: view() },
    })
    const a = e2e(def)
    await a.run.start()
    void a.run.next()
    expect(a.run.getState().nav.phase).toBe('canExit')
    const snap = roundTrip(a.run.getSnapshot())
    a.run.dispose()
    const b = e2eResume(def, snap)
    expect(b.of('transition.rejected')[0]).toMatchObject({ reason: 'resumed' })
    expect(b.run.getState().nav.phase).toBe('idle')
    expect(b.run.getState().current).toBe('a')
  })

  it('nested: children are restored from the snapshot; a missing child snapshot is re-created via childContext', async () => {
    const child = flow({
      name: 'child',
      start: 'v',
      steps: { v: view({ next: 'e' }), e: runStep({ run: () => 'child done' }) },
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
        end: runStep({
          needs: { f: { kind: 'all', steps: ['f'] } },
          run: ({ needs }) => needs.f,
        }),
      },
    })
    const a = e2e(parent)
    await a.run.start()
    const childId = a.run.child('f').id
    expect(a.run.child('f').getState().context).toEqual({ n: 1 })
    const snap = a.run.getSnapshot()
    a.run.dispose()

    // Restored: same child instance id, epoch bumped, still on its view; finishing it finishes the parent.
    const b = e2eResume(parent, roundTrip(snap))
    const c = b.run.child('f')
    expect(c.id).toBe(childId)
    expect(c.epoch).toBe(1)
    expect(c.getState().current).toBe('v')
    expect(contextCalls).toBe(1)
    await c.next()
    expect(b.run.getState().status).toBe('done')
    expect(b.run.getState().output).toBe('child done')

    // Missing child snapshot: the parent forgets the summary → plan(flow.resumed) calls childContext again.
    const d = e2eResume(parent, roundTrip({ ...snap, children: {} }))
    expect(contextCalls).toBe(2)
    expect(d.of('child.started')[0]).toMatchObject({ step: 'f', context: { n: 2 } })
    const recreated = d.run.child('f')
    expect(recreated.epoch).toBe(0) // a fresh instance, not a restored one
    expect(recreated.getState().context).toEqual({ n: 2 })
    expect(recreated.getState().current).toBe('v')
    expect(d.rec('f').child).toMatchObject({ status: 'waiting' })
  })
})
