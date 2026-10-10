/**
 * (c) wait steps with the REAL machine: send() delivered, early event buffered
 * then delivered on entry, TTL expiry, wait timeout branch (`timeout.next`),
 * handler `{ next }` override, `keep`, and the sendRejected path (boundary).
 */

import { describe, expect, it } from 'vitest'
import { final, flow, guard, task, view, wait } from '../../helpers/fixtures'
import { e2e } from './harness'

const paymentEvent = guard((v) => typeof (v as any)?.paymentId === 'string', 'paymentId required')

describe('e2e wait: routing, inbox, timeouts', () => {
  it('delivers a matching event to the active wait, runs the handler and completes the step', async () => {
    const def = flow({
      name: 'wait',
      start: 'w',
      events: { 'payment.captured': paymentEvent },
      steps: {
        w: wait({
          on: {
            'payment.captured': ({ payload, update }) => {
              update({ paymentId: (payload as any).paymentId })
            },
          },
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def, { context: {} })
    await t.wizard.start()
    expect(t.wizard.getState().status).toBe('waiting')
    const bad = await t.wizard.send('payment.captured', { nope: 1 })
    expect(bad).toEqual({
      ok: false,
      reason: 'rejected',
      code: 'BOUNDARY_REJECTED',
      message: 'payload rejected by the event boundary',
      issues: [{ message: 'paymentId required' }],
    })
    expect(t.of('event.rejected')[0]).toMatchObject({
      event: 'payment.captured',
      issues: [{ message: 'paymentId required' }],
    })
    expect(t.rec('w').status).toBe('active')

    const good = await t.wizard.send(
      'payment.captured',
      { paymentId: 'p_1' },
      { correlationId: 'req-1' },
    )
    expect(good).toMatchObject({ ok: true, delivered: ['w'], buffered: false })
    expect(t.of('event.received')[0]).toMatchObject({
      event: 'payment.captured',
      correlationId: 'req-1',
      payload: { paymentId: 'p_1' },
    })
    expect(t.of('event.delivered')[0]).toMatchObject({ to: 'w', payload: { paymentId: 'p_1' } })
    // Handler `update()` landed before the step completed; output = { event, payload } by default.
    expect(t.wizard.getState().context).toEqual({ paymentId: 'p_1' })
    expect(t.rec('w')).toMatchObject({
      status: 'done',
      output: { event: 'payment.captured', payload: { paymentId: 'p_1' } },
    })
    expect(t.wizard.getState().status).toBe('done')
    const order = t.types()
    expect(order.indexOf('context.changed')).toBeLessThan(order.indexOf('step.done'))
  })

  it('buffers an early event, delivers it when the wait enters, and expires stale entries by TTL', async () => {
    const def = flow({
      name: 'early',
      start: 'form',
      policies: { unmatchedEvents: { buffer: true, ttlMs: 1_000 } },
      events: { hello: guard(() => true), other: guard(() => true) },
      steps: {
        form: view({ next: 'w' }),
        w: wait({ on: { hello: ({ payload }) => ({ done: { got: payload } }) }, next: 'end' }),
        end: final(),
      },
    })
    const t = e2e(def, { now: 1_000 })
    await t.wizard.start()
    // Nobody listens yet → buffered with a TTL timer.
    const early = await t.wizard.send('hello', { n: 1 })
    expect(early).toMatchObject({ ok: true, delivered: [], buffered: true })
    expect(t.of('event.buffered')[0]).toMatchObject({
      event: 'hello',
      expiresAt: 2_000,
      payload: { n: 1 },
    })
    expect(t.wizard.getState().inbox).toHaveLength(1)
    expect(t.sched.pending()).toBe(1)
    // A second buffered event of another kind expires by TTL.
    await t.wizard.send('other', { n: 2 })
    expect(t.wizard.getState().inbox).toHaveLength(2)
    // Move the cursor: the wait enters and drains the oldest matching entry first.
    t.sched.advance(500)
    await t.wizard.next()
    expect(t.of('event.delivered')[0]).toMatchObject({ event: 'hello', to: 'w', payload: { n: 1 } })
    expect(t.rec('w')).toMatchObject({ status: 'done', output: { got: { n: 1 } } })
    expect(t.wizard.getState().status).toBe('done')
    expect(t.wizard.getState().inbox.map((e) => e.event)).toEqual(['other'])
    // The remaining entry expires when its TTL timer fires (flow is done; the inbox still empties).
    t.sched.advance(500)
    expect(t.of('event.expired')[0]).toMatchObject({ event: 'other' })
    expect(t.wizard.getState().inbox).toEqual([])
    expect(t.wizard.getState().timers).toEqual({})
  })

  it('drops when buffering is off', async () => {
    const def = flow({
      name: 'nobuf',
      start: 'form',
      policies: { unmatchedEvents: { buffer: false, ttlMs: 0 } },
      events: { hello: guard(() => true) },
      steps: { form: view({ next: 'end' }), end: final() },
    })
    const t = e2e(def)
    await t.wizard.start()
    expect(await t.wizard.send('hello', {})).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'NOT_ACTIVE',
      message: 'no-listener',
    })
    expect(t.of('event.dropped')[0]).toMatchObject({ event: 'hello', reason: 'no-listener' })
  })

  it('wait timeout: the deadline is state, the timer fires through the scheduler and routes to timeout.next', async () => {
    const def = flow({
      name: 'timeout',
      start: 'w',
      events: { hello: guard(() => true) },
      steps: {
        w: wait({
          on: { hello: () => undefined },
          timeout: { afterMs: 15 * 60_000, next: 'expired' },
          next: 'ok',
        }),
        ok: final(),
        expired: final({ output: () => 'timed out' }),
      },
    })
    const t = e2e(def, { now: 100_000 })
    await t.wizard.start()
    expect(t.rec('w').deadline).toBe(100_000 + 15 * 60_000)
    expect(t.of('timer.scheduled')[0]).toMatchObject({
      timerId: 'wait:w',
      dueAt: 100_000 + 15 * 60_000,
      purpose: 'waitTimeout',
      step: 'w',
    })
    t.sched.advance(15 * 60_000 - 1)
    expect(t.wizard.getState().status).toBe('waiting')
    t.sched.advance(1)
    expect(t.of('timer.fired')[0]).toMatchObject({ timerId: 'wait:w' })
    expect(t.rec('w')).toMatchObject({ status: 'done', output: { event: 'timeout' } })
    expect(t.of('step.done')[0]).toMatchObject({ step: 'w', next: 'expired' })
    expect(t.rec('expired').status).toBe('done')
    expect(t.rec('ok').status).toBe('idle')
    expect(t.wizard.getState().output).toBe('timed out')
    expect(t.wizard.getState().timers).toEqual({})
    // A late event is rejected as a value (terminal).
    expect(await t.wizard.send('hello', {})).toMatchObject({ ok: false, reason: 'dropped' })
  })

  it('a handler may keep waiting, override the target with { next }, or fail the step', async () => {
    let mode: 'keep' | 'next' | 'fail' = 'keep'
    const def = flow({
      name: 'handler',
      start: 'w',
      events: { ping: guard(() => true) },
      steps: {
        w: wait({
          on: {
            ping: () =>
              mode === 'keep'
                ? { keep: true }
                : mode === 'next'
                  ? { next: 'alt', done: 'routed' }
                  : { fail: 'refused' },
          },
          timeout: { afterMs: 1_000, next: 'end' },
          next: 'end',
        }),
        alt: final({ output: () => 'alt' }),
        end: final(),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    expect(await t.wizard.send('ping', {})).toMatchObject({ ok: true, delivered: ['w'] })
    expect(t.rec('w').status).toBe('active') // keep
    expect(t.wizard.getState().timers['wait:w']).toBeDefined()
    mode = 'next'
    await t.wizard.send('ping', {})
    expect(t.rec('w')).toMatchObject({ status: 'done', output: 'routed' })
    expect(t.of('step.done').find((e) => e.step === 'w')).toMatchObject({ next: 'alt' })
    expect(t.wizard.getState().output).toBe('alt')
    expect(t.wizard.getState().timers).toEqual({}) // timeout timer cleared on completion
    expect(t.sched.pending()).toBe(0)

    // fail path
    mode = 'fail'
    const t2 = e2e(def)
    await t2.wizard.start()
    await t2.wizard.send('ping', {})
    expect(t2.rec('w')).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'refused' },
    })
    expect(t2.wizard.getState().status).toBe('failed')
  })

  it('a handler that throws fails the wait step (kind hook) under the halt policy', async () => {
    const def = flow({
      name: 'throw',
      start: 'w',
      events: { ping: guard(() => true) },
      steps: {
        w: wait({
          on: {
            ping: () => {
              throw new Error('handler exploded')
            },
          },
          next: 'end',
        }),
        end: final(),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    const r = await t.wizard.send('ping', {})
    expect(r).toMatchObject({ ok: true, delivered: ['w'] }) // routing succeeded; failure is a state fact
    expect(t.rec('w')).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'handler exploded' },
    })
    expect(t.wizard.getState().status).toBe('failed')
  })

  it('a task in flight while a wait listens: send() to the wait works while the task runs', async () => {
    let finish: (v: unknown) => void = () => {}
    const def = flow({
      name: 'parallel',
      start: ['t', 'w'],
      events: { ping: guard(() => true) },
      steps: {
        t: task({ run: () => new Promise((r) => (finish = r)) }),
        w: wait({ on: { ping: () => ({ done: 'pinged' }) } }),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    expect(t.wizard.getState().active).toEqual(['t', 'w'])
    expect(t.wizard.getState().status).toBe('running')
    expect(await t.wizard.send('ping', {})).toMatchObject({ ok: true, delivered: ['w'] })
    expect(t.rec('w')).toMatchObject({ status: 'done', output: 'pinged' })
    finish('t-done')
    await Promise.resolve()
    await Promise.resolve()
    expect(t.rec('t')).toMatchObject({ status: 'done', output: 't-done' })
    expect(t.wizard.getState().active).toEqual([])
  })
})
