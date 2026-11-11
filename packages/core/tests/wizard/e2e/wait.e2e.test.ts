/**
 * (c) wait steps with the REAL machine: send() delivered, early event buffered
 * then delivered on entry, TTL expiry, wait timeout branch (`timeout.next`),
 * handler-driven routing through `next`, `keep`, and boundary rejection.
 */

import { describe, expect, it } from 'vitest'
import { eventStep, flow, guard, routingStep, runStep, view } from '../../helpers/fixtures'
import { e2e } from './harness'

const paymentEvent = guard((v) => typeof (v as any)?.paymentId === 'string', 'paymentId required')

describe('e2e wait: routing, inbox, timeouts', () => {
  it('delivers a matching event to the active wait, runs the handler and completes the step', async () => {
    const def = flow({
      name: 'wait',
      start: 'w',
      events: { 'payment.captured': paymentEvent },
      steps: {
        w: eventStep({
          on: {
            'payment.captured': ({ payload, update }) => {
              update({ paymentId: (payload as any).paymentId })
            },
          },
          next: 'end',
        }),
        end: routingStep(),
      },
    })
    const t = e2e(def, { context: {} })
    await t.run.start()
    expect(t.run.getState().status).toBe('waiting')
    const bad = await t.run.send('payment.captured', { nope: 1 })
    expect(bad).toEqual({
      ok: false,
      reason: 'rejected',
      code: 'BOUNDARY_REJECTED',
      message:
        "the payload of 'payment.captured' was rejected by its event boundary: paymentId required",
      issues: [{ message: 'paymentId required' }],
    })
    expect(t.of('event.rejected')[0]).toMatchObject({
      event: 'payment.captured',
      issues: [{ message: 'paymentId required' }],
    })
    expect(t.rec('w').status).toBe('active')

    const good = await t.run.send(
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
    // Handler `update()` lands before completion; an omitted result uses the payload as output.
    expect(t.run.getState().context).toEqual({ paymentId: 'p_1' })
    expect(t.rec('w')).toMatchObject({
      status: 'done',
      output: { paymentId: 'p_1' },
    })
    expect(t.run.getState().status).toBe('done')
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
        w: eventStep({ on: { hello: ({ payload }) => ({ done: { got: payload } }) }, next: 'end' }),
        end: routingStep(),
      },
    })
    const t = e2e(def, { now: 1_000 })
    await t.run.start()
    // Nobody listens yet → buffered with a TTL timer.
    const early = await t.run.send('hello', { n: 1 })
    expect(early).toMatchObject({ ok: true, delivered: [], buffered: true })
    expect(t.of('event.buffered')[0]).toMatchObject({
      event: 'hello',
      expiresAt: 2_000,
      payload: { n: 1 },
    })
    expect(t.run.getState().inbox).toHaveLength(1)
    expect(t.sched.pending()).toBe(1)
    // A second buffered event of another kind expires by TTL.
    await t.run.send('other', { n: 2 })
    expect(t.run.getState().inbox).toHaveLength(2)
    // Move the cursor: the wait enters and drains the oldest matching entry first.
    t.sched.advance(500)
    await t.run.next()
    expect(t.of('event.delivered')[0]).toMatchObject({ event: 'hello', to: 'w', payload: { n: 1 } })
    expect(t.rec('w')).toMatchObject({ status: 'done', output: { got: { n: 1 } } })
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().inbox.map((e) => e.event)).toEqual(['other'])
    // The remaining entry expires when its TTL timer fires (flow is done; the inbox still empties).
    t.sched.advance(500)
    expect(t.of('event.expired')[0]).toMatchObject({ event: 'other' })
    expect(t.run.getState().inbox).toEqual([])
    expect(t.run.getState().timers).toEqual({})
  })

  it('drops when buffering is off', async () => {
    const def = flow({
      name: 'nobuf',
      start: 'form',
      policies: { unmatchedEvents: { buffer: false, ttlMs: 0 } },
      events: { hello: guard(() => true) },
      steps: { form: view({ next: 'end' }), end: routingStep() },
    })
    const t = e2e(def)
    await t.run.start()
    expect(await t.run.send('hello', {})).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'NOT_ACTIVE',
      message: "no step is waiting for 'hello' and unmatched events are not buffered",
    })
    expect(t.of('event.dropped')[0]).toMatchObject({ event: 'hello', reason: 'no-listener' })
  })

  it('wait timeout: the deadline is state, the timer fires through the scheduler and routes to timeout.next', async () => {
    const def = flow({
      name: 'timeout',
      start: 'w',
      events: { hello: guard(() => true) },
      steps: {
        w: eventStep({
          on: { hello: () => undefined },
          timeout: { afterMs: 15 * 60_000, next: 'expired' },
          next: 'ok',
        }),
        ok: routingStep(),
        expired: runStep({ run: () => 'timed out' }),
      },
    })
    const t = e2e(def, { now: 100_000 })
    await t.run.start()
    expect(t.rec('w').deadline).toBe(100_000 + 15 * 60_000)
    expect(t.of('timer.scheduled')[0]).toMatchObject({
      timerId: 'wait:w',
      dueAt: 100_000 + 15 * 60_000,
      purpose: 'waitTimeout',
      step: 'w',
    })
    t.sched.advance(15 * 60_000 - 1)
    expect(t.run.getState().status).toBe('waiting')
    t.sched.advance(1)
    expect(t.of('timer.fired')[0]).toMatchObject({ timerId: 'wait:w' })
    expect(t.rec('w')).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(t.of('step.skipped')[0]).toMatchObject({ step: 'w', reason: 'timeout', next: 'expired' })
    expect(t.of('step.done').map((e) => e.step)).toEqual(['expired'])
    expect(t.rec('expired').status).toBe('done')
    expect(t.rec('ok')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(t.run.getState().output).toBe('timed out')
    expect(t.run.getState().timers).toEqual({})
    // A late event is rejected as a value (terminal).
    expect(await t.run.send('hello', {})).toMatchObject({ ok: false, reason: 'dropped' })
  })

  it('a handler may keep waiting, return data for a declared route, or fail the step', async () => {
    let mode: 'keep' | 'next' | 'fail' = 'keep'
    const def = flow({
      name: 'handler',
      start: 'w',
      events: { ping: guard(() => true) },
      steps: {
        w: eventStep({
          on: {
            ping: ({ update }) => {
              if (mode === 'keep') return { keep: true }
              if (mode === 'fail') return { fail: 'refused' }
              update({ route: 'alt' })
              return { done: 'routed' }
            },
          },
          timeout: { afterMs: 1_000, next: 'end' },
          dynamicNext: ({ context }) =>
            (context as { route?: string }).route === 'alt' ? 'alt' : 'end',
          targets: ['alt', 'end'],
        }),
        alt: runStep({ run: () => 'alt' }),
        end: routingStep(),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(await t.run.send('ping', {})).toMatchObject({ ok: true, delivered: ['w'] })
    expect(t.rec('w').status).toBe('active') // keep
    expect(t.run.getState().timers['wait:w']).toBeDefined()
    mode = 'next'
    await t.run.send('ping', {})
    expect(t.rec('w')).toMatchObject({ status: 'done', output: 'routed' })
    expect(t.of('transition.committed').at(-1)).toMatchObject({ from: 'w', to: 'alt' })
    expect(t.run.getState().output).toBe('alt')
    expect(t.run.getState().timers).toEqual({}) // timeout timer cleared on completion
    expect(t.sched.pending()).toBe(0)

    // fail path
    mode = 'fail'
    const t2 = e2e(def)
    await t2.run.start()
    await t2.run.send('ping', {})
    expect(t2.rec('w')).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'refused' },
    })
    expect(t2.run.getState().status).toBe('halted')
  })

  it('a handler that throws fails the wait step (kind hook) under the halt policy', async () => {
    const def = flow({
      name: 'throw',
      start: 'w',
      events: { ping: guard(() => true) },
      steps: {
        w: eventStep({
          on: {
            ping: () => {
              throw new Error('handler exploded')
            },
          },
          next: 'end',
        }),
        end: routingStep(),
      },
    })
    const t = e2e(def)
    await t.run.start()
    const r = await t.run.send('ping', {})
    expect(r).toMatchObject({ ok: true, delivered: ['w'] }) // routing succeeded; failure is a state fact
    expect(t.rec('w')).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'handler exploded' },
    })
    expect(t.run.getState().status).toBe('halted')
  })

  it('a step in flight while a wait listens: send() to the wait works while the step runs', async () => {
    let finish: (v: unknown) => void = () => {}
    const def = flow({
      name: 'parallel',
      start: ['t', 'w'],
      events: { ping: guard(() => true) },
      steps: {
        t: runStep({ run: () => new Promise((r) => (finish = r)) }),
        w: eventStep({ on: { ping: () => ({ done: 'pinged' }) } }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.run.getState().active).toEqual(['t', 'w'])
    expect(t.run.getState().status).toBe('running')
    expect(await t.run.send('ping', {})).toMatchObject({ ok: true, delivered: ['w'] })
    expect(t.rec('w')).toMatchObject({ status: 'done', output: 'pinged' })
    finish('t-done')
    await Promise.resolve()
    await Promise.resolve()
    expect(t.rec('t')).toMatchObject({ status: 'done', output: 't-done' })
    expect(t.run.getState().active).toEqual([])
  })
})
