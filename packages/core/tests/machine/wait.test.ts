import { describe, expect, it } from 'vitest'
import { createHarness, final, flow, of, view, wait } from '../helpers/fixtures'

const on = () => undefined

const waiting = (
  opts: { buffer?: boolean; ttlMs?: number; timeout?: { afterMs: number; next: string } } = {},
) =>
  flow({
    start: 'w',
    steps: {
      w: wait({
        on: { paid: on, failed: on },
        next: 'end',
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
      }),
      expired: final(),
      end: final(),
    },
    policies: { unmatchedEvents: { buffer: opts.buffer ?? true, ttlMs: opts.ttlMs ?? 5_000 } },
  })

describe('wait — routing', () => {
  it('send to an active wait: event.received + event.delivered → call on{event,payload,inboxId}; result completes the wait', () => {
    const h = createHarness(waiting())
    h.start()
    expect(h.state.status).toBe('waiting')
    const r = h.cmd({ type: 'send', event: 'paid', payload: { amount: 5 }, correlationId: 'c1' })
    expect(r.types).toEqual(['event.received', 'event.delivered'])
    expect(of(r, 'event.received')[0]).toMatchObject({
      event: 'paid',
      payload: { amount: 5 },
      correlationId: 'c1',
      inboxId: 'evt-1',
    })
    expect(of(r, 'event.delivered')[0]).toMatchObject({
      event: 'paid',
      to: 'w',
      inboxId: 'evt-1',
      payload: { amount: 5 },
    })
    const call = h.call('on')
    expect(call).toMatchObject({
      step: 'w',
      extra: { event: 'paid', payload: { amount: 5 }, inboxId: 'evt-1' },
      token: { step: 'w', runId: 1 },
    })
    const done = h.ok(call, undefined)
    expect(done.types.slice(0, 1)).toEqual(['step.done'])
    expect(of(done, 'step.done')[0]?.output).toEqual({ event: 'paid', payload: { amount: 5 } })
    expect(h.state.status).toBe('done')
  })

  it('an event with no handler on the active wait is buffered (with a TTL timer); one without buffering is dropped', () => {
    const h = createHarness(waiting({ ttlMs: 1_000 }))
    h.start()
    const r = h.cmd({ type: 'send', event: 'other', payload: 1 })
    expect(r.types).toEqual(['event.received', 'event.buffered', 'timer.scheduled'])
    expect(of(r, 'event.buffered')[0]).toMatchObject({
      event: 'other',
      inboxId: 'evt-1',
      expiresAt: h.clock.now + 1_000,
      payload: 1,
    })
    expect(h.state.inbox).toEqual([
      { id: 'evt-1', event: 'other', payload: 1, at: h.clock.now, expiresAt: h.clock.now + 1_000 },
    ])
    expect(h.state.timers['inbox:evt-1']).toMatchObject({
      at: h.clock.now + 1_000,
      purpose: 'inboxTtl',
    })
    expect(r.effects[0]).toMatchObject({
      kind: 'timer.set',
      timerId: 'inbox:evt-1',
      fire: { type: 'timer.fired', timerId: 'inbox:evt-1' },
    })

    const nb = createHarness(waiting({ buffer: false }))
    nb.start()
    const d = nb.cmd({ type: 'send', event: 'other', payload: 1 })
    expect(d.types).toEqual(['event.received', 'event.dropped'])
    expect(of(d, 'event.dropped')[0]).toMatchObject({ event: 'other', reason: 'no-listener' })
  })

  it('broadcast: every active wait listening for the event gets its own delivery and consumes independently', () => {
    const h = createHarness(
      flow({
        start: ['w1', 'w2'],
        steps: {
          w1: wait({ on: { ping: on }, next: 'end' }),
          w2: wait({ on: { ping: on }, next: 'end' }),
          end: final({ dependsOn: ['w1', 'w2'] }),
        },
      }),
    )
    h.start()
    const r = h.cmd({ type: 'send', event: 'ping', payload: null })
    expect(of(r, 'event.delivered').map((e) => e.to)).toEqual(['w1', 'w2'])
    const calls = h.pending('on')
    expect(calls.map((c) => c.step)).toEqual(['w1', 'w2'])
    h.ok(calls[1]!, undefined)
    expect(h.rec('w2').status).toBe('done')
    expect(h.rec('w1').status).toBe('active')
    h.ok(calls[0]!, undefined)
    expect(h.state.status).toBe('done')
  })

  it('sendRejected → event.rejected{issues}', () => {
    const h = createHarness(waiting())
    h.start()
    const r = h.cmd({
      type: 'sendRejected',
      event: 'paid',
      issues: [{ message: 'amount missing' }],
    })
    expect(r.types).toEqual(['event.rejected'])
    expect(of(r, 'event.rejected')[0]).toMatchObject({
      event: 'paid',
      issues: [{ message: 'amount missing' }],
    })
  })

  it('handler results: keep stays waiting; {next} overrides the target; {done} overrides the output; {fail} fails the step', () => {
    const mk = () =>
      createHarness(
        flow({
          start: 'w',
          steps: {
            w: wait({ on: { e: on }, next: 'a' }),
            a: final(),
            b: final(),
          },
        }),
      )
    // keep
    const keep = mk()
    keep.start()
    keep.cmd({ type: 'send', event: 'e', payload: 1 })
    expect(keep.ok(keep.call('on'), { keep: true }).types).toEqual([])
    expect(keep.rec('w').status).toBe('active')
    // next override
    const nxt = mk()
    nxt.start()
    nxt.cmd({ type: 'send', event: 'e', payload: 1 })
    const r = nxt.ok(nxt.call('on'), { next: 'b' })
    expect(of(r, 'step.done')[0]).toMatchObject({ next: 'b' })
    expect(of(r, 'transition.started')[0]).toMatchObject({ from: 'w', to: 'b', cause: 'auto' })
    expect(nxt.rec('b').status).toBe('done')
    expect(nxt.rec('a').status).toBe('idle')
    // done override
    const dn = mk()
    dn.start()
    dn.cmd({ type: 'send', event: 'e', payload: 1 })
    expect(of(dn.ok(dn.call('on'), { done: 'custom' }), 'step.done')[0]?.output).toBe('custom')
    // fail
    const fl = mk()
    fl.start()
    fl.cmd({ type: 'send', event: 'e', payload: 1 })
    const f = fl.ok(fl.call('on'), { fail: 'rejected by handler' })
    expect(f.types).toEqual(['step.failed', 'flow.failed'])
    expect(fl.rec('w').error).toMatchObject({ kind: 'hook', message: 'rejected by handler' })
    // unknown next
    const un = mk()
    un.start()
    un.cmd({ type: 'send', event: 'e', payload: 1 })
    expect(of(un.ok(un.call('on'), { next: 'zzz' }), 'step.failed')[0]?.error.code).toBe(
      'UNKNOWN_STEP',
    )
  })

  it('handler error → step.failed{kind:hook}; a stale on-result (step no longer active) is ignored', () => {
    const h = createHarness(waiting())
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 1 })
    h.cmd({ type: 'send', event: 'failed', payload: 2 })
    const [first, second] = h.pending('on')
    const r = h.err(first!, 'handler threw')
    expect(r.types).toEqual(['step.failed', 'flow.failed'])
    expect(h.ok(second!, undefined).types).toEqual(['result.ignored'])
  })
})

describe('wait — inbox drain, TTL, timeout', () => {
  it('an early event is buffered and delivered when a matching wait enters (drain on enter, oldest first, one per drain)', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ next: 'w' }),
          w: wait({ on: { paid: on }, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'first' })
    h.cmd({ type: 'send', event: 'paid', payload: 'second' })
    expect(h.state.inbox.map((e) => e.payload)).toEqual(['first', 'second'])
    const r = h.cmd('next')
    // the wait enters, clears the TTL timer of the drained entry and delivers exactly one entry
    expect(r.types.filter((t) => t.startsWith('event.') || t.startsWith('timer.'))).toEqual([
      'timer.cleared',
      'event.delivered',
    ])
    expect(of(r, 'event.delivered')[0]).toMatchObject({
      inboxId: 'evt-1',
      payload: 'first',
      to: 'w',
    })
    expect(h.state.inbox.map((e) => e.id)).toEqual(['evt-2'])
    expect(h.state.timers['inbox:evt-1']).toBeUndefined()
    const call = h.call('on')
    expect(call.extra).toMatchObject({ event: 'paid', payload: 'first', inboxId: 'evt-1' })
    // keep → the next drain delivers the second buffered entry
    const k = h.ok(call, { keep: true })
    expect(k.types).toEqual(['timer.cleared', 'event.delivered'])
    expect(of(k, 'event.delivered')[0]?.payload).toBe('second')
    expect(h.state.inbox).toEqual([])
    h.ok(h.call('on'), undefined)
    expect(h.state.status).toBe('done')
  })

  it('TTL: the inbox timer expires the entry (event.expired); a stale timer id is ignored', () => {
    const h = createHarness(waiting({ ttlMs: 100 }))
    h.start()
    h.cmd({ type: 'send', event: 'other', payload: 1 })
    h.clock.advance(100)
    const r = h.fire('inbox:evt-1')
    expect(r.types).toEqual(['timer.fired', 'event.expired'])
    expect(of(r, 'event.expired')[0]).toMatchObject({ event: 'other', inboxId: 'evt-1' })
    expect(h.state.inbox).toEqual([])
    expect(h.state.timers).toEqual({})
    expect(h.fire('inbox:evt-1').types).toEqual([])
  })

  it('lazy expiry: an expired entry is dropped (timer cleared) when a wait drains, instead of being delivered', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: { v: view({ next: 'w' }), w: wait({ on: { paid: on }, next: 'end' }), end: final() },
        policies: { unmatchedEvents: { buffer: true, ttlMs: 50 } },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'stale' })
    h.clock.advance(60)
    const r = h.cmd('next')
    expect(r.types.filter((t) => t.startsWith('event.') || t.startsWith('timer.'))).toEqual([
      'timer.cleared',
      'event.expired',
    ])
    expect(h.pending('on')).toHaveLength(0)
    expect(h.rec('w').status).toBe('active')
  })

  it('wait timeout: timer armed on entry (deadline stored), fires → step.done{event:timeout} and auto-advance to timeout.next', () => {
    const h = createHarness(waiting({ timeout: { afterMs: 1_000, next: 'expired' } }))
    const r = h.start()
    expect(r.types).toEqual(['flow.started', 'step.arrived', 'step.entered', 'timer.scheduled'])
    expect(of(r, 'timer.scheduled')[0]).toMatchObject({
      timerId: 'wait:w',
      dueAt: h.clock.now + 1_000,
      purpose: 'waitTimeout',
      step: 'w',
    })
    expect(h.rec('w').deadline).toBe(h.clock.now + 1_000)
    expect(r.effects.map((e) => e.kind)).toEqual(['timer.set', 'persist'])
    h.clock.advance(1_000)
    const fired = h.fire('wait:w')
    expect(fired.types.slice(0, 2)).toEqual(['timer.fired', 'step.done'])
    expect(of(fired, 'step.done')[0]).toMatchObject({
      output: { event: 'timeout' },
      next: 'expired',
    })
    expect(h.rec('expired').status).toBe('done')
    expect(h.rec('end').status).toBe('idle')
    expect(h.state.status).toBe('done')
    expect(h.state.timers).toEqual({})
  })

  it('completing a wait clears its timeout timer (timer.cleared → timer.clear)', () => {
    const h = createHarness(waiting({ timeout: { afterMs: 1_000, next: 'expired' } }))
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 1 })
    const r = h.ok(h.call('on'), undefined)
    expect(r.types.slice(0, 2)).toEqual(['timer.cleared', 'step.done'])
    expect(r.effects[0]).toEqual({ kind: 'timer.clear', timerId: 'wait:w' })
    expect(h.rec('w').deadline).toBeUndefined()
    // the timer firing later is a no-op (already removed)
    expect(h.fire('wait:w').types).toEqual([])
  })

  it('a wait with an enter hook is not listening until enter resolves: the event is buffered, then drained', () => {
    const h = createHarness(
      flow({
        start: 'w',
        steps: { w: wait({ enter: () => undefined, on: { paid: on }, next: 'end' }), end: final() },
      }),
    )
    h.start()
    expect(h.rec('w').entering).toBe(true)
    const r = h.cmd({ type: 'send', event: 'paid', payload: 'early' })
    expect(r.types).toEqual(['event.received', 'event.buffered', 'timer.scheduled'])
    const done = h.ok(h.call('enter'))
    expect(done.types).toEqual(['step.enterCompleted', 'timer.cleared', 'event.delivered'])
    expect(h.call('on').extra).toMatchObject({ payload: 'early' })
  })
})
