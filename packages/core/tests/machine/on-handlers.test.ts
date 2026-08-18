/**
 * v0.2 §10.1 — `on[event]` handlers on every kind, flow-level `on`, correlation.
 * Pure machine tests (decide / apply / plan through the harness).
 */
import { describe, expect, it } from 'vitest'
import { createHarness, final, flow, of, replay, task, view, wait } from '../helpers/fixtures'

const on = () => undefined
const yes = () => true

describe('on — routing to every kind', () => {
  it('a view with a matching handler is a delivery target; `{ next }` starts a transition with cause "event" (canEnter/exit/enter, no validation)', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ canExit: () => false, exit: on, on: { go: on }, next: 'a' }),
          a: view({ canEnter: yes }),
          b: view({ canEnter: yes, enter: on }),
        },
      }),
    )
    h.start()
    const r = h.cmd({ type: 'send', event: 'go', payload: { to: 'b' } })
    expect(r.types).toEqual(['event.received', 'event.delivered'])
    expect(of(r, 'event.delivered')[0]).toMatchObject({ to: 'v', event: 'go' })
    const call = h.call('on', 'v')
    expect(call.extra).toMatchObject({ event: 'go', payload: { to: 'b' } })
    const t = h.ok(call, { next: 'b' })
    // canExit is NOT consulted (it would veto), parseInput/validate are skipped
    expect(t.types.slice(0, 3)).toEqual([
      'transition.started',
      'transition.phase',
      'transition.phase',
    ])
    expect(of(t, 'transition.started')[0]).toMatchObject({ from: 'v', to: 'b', cause: 'event' })
    expect(h.state.nav.phase).toBe('canEnter')
    h.ok(h.call('canEnter', 'b'), true)
    expect(h.state.nav.phase).toBe('exiting')
    h.ok(h.call('exit', 'v'))
    expect(h.state.nav.phase).toBe('entering')
    const done = h.ok(h.call('enter', 'b'))
    expect(of(done, 'step.exited')[0]).toMatchObject({ step: 'v', to: 'b', direction: 'forward' })
    expect(of(done, 'transition.committed')[0]).toMatchObject({
      from: 'v',
      to: 'b',
      cause: 'event',
    })
    expect(h.state.current).toBe('b')
    expect(h.rec('v').status).toBe('done')
    expect(h.rec('v').output).toBeUndefined() // never parsed
    expect(h.state.history).toEqual(['v', 'b'])
    expect(replay(h)).toEqual(h.state)
  })

  it('a nav-busy view is not a target: the event is buffered (even with buffering off) and delivered on the next idle drain', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ canExit: yes, on: { ping: on }, next: 'end' }),
          end: final(),
        },
        policies: { unmatchedEvents: { buffer: false, ttlMs: 500 } },
      }),
    )
    h.start()
    h.cmd('next') // canExit pending → nav busy
    expect(h.state.nav.phase).toBe('canExit')
    const r = h.cmd({ type: 'send', event: 'ping', payload: 1 })
    expect(r.types).toEqual(['event.received', 'event.buffered', 'timer.scheduled'])
    expect(h.state.inbox).toHaveLength(1)
    // the transition is rejected → nav idle → the current view drains the entry
    const rej = h.ok(h.call('canExit'), false)
    expect(rej.types).toEqual([
      'step.guardEvaluated',
      'transition.rejected',
      'timer.cleared',
      'event.delivered',
    ])
    expect(of(rej, 'event.delivered')[0]).toMatchObject({ to: 'v', event: 'ping' })
    expect(h.state.inbox).toEqual([])
    const call = h.call('on', 'v')
    expect(h.ok(call, undefined).types).toEqual([])
    expect(h.rec('v').status).toBe('active')
    expect(replay(h)).toEqual(h.state)
  })

  it('a view handler `{ next }` arriving while nav is busy is ignored (event.handlerResultIgnored { reason: nav-busy })', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ canExit: yes, on: { go: on }, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'go', payload: 1 })
    const call = h.call('on', 'v')
    h.cmd('next') // busy now (async canExit)
    const r = h.ok(call, { next: 'end' })
    expect(r.types).toEqual(['event.handlerResultIgnored'])
    expect(of(r, 'event.handlerResultIgnored')[0]).toEqual(
      expect.objectContaining({ step: 'v', event: 'go', reason: 'nav-busy' }),
    )
    expect(h.state.nav.phase).toBe('canExit')
  })

  it('a task handler may only update(): a returned { next } is ignored (reason: kind) and the run continues', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ on: { progress: on }, next: 'end' }),
          other: final(),
          end: final(),
        },
      }),
    )
    h.start()
    const r = h.cmd({ type: 'send', event: 'progress', payload: 42 })
    expect(r.types).toEqual(['event.received', 'event.delivered'])
    const ig = h.ok(h.call('on', 't'), { next: 'other' })
    expect(ig.types).toEqual(['event.handlerResultIgnored'])
    expect(of(ig, 'event.handlerResultIgnored')[0]).toMatchObject({
      step: 't',
      event: 'progress',
      reason: 'kind',
    })
    expect(h.rec('t').status).toBe('active')
    // a void result is silent
    h.cmd({ type: 'send', event: 'progress', payload: 43 })
    expect(h.ok(h.call('on', 't'), undefined).types).toEqual([])
    h.ok(h.call('run', 't'), 'ok')
    expect(h.state.status).toBe('done')
    expect(h.rec('other').status).toBe('idle')
  })

  it('a non-wait handler that throws is recorded (event.handlerFailed) and the step keeps going; a wait handler failure still fails the wait', () => {
    const h = createHarness(
      flow({
        start: ['t', 'w'],
        steps: {
          t: task({ on: { e: on }, next: 'end' }),
          w: wait({ on: { e: on }, next: 'end' }),
          end: final({ dependsOn: ['t', 'w'] }),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'e', payload: null })
    const [forT, forW] = h.pending('on')
    const r = h.err(forT!, 'task handler bug')
    expect(r.types).toEqual(['event.handlerFailed'])
    expect(of(r, 'event.handlerFailed')[0]).toMatchObject({
      step: 't',
      event: 'e',
      error: { message: 'task handler bug' },
    })
    expect(h.rec('t').status).toBe('active')
    expect(h.err(forW!, 'wait handler bug').types).toEqual(['step.failed', 'flow.failed'])
  })

  it('a task drains buffered events when it starts (one per drain), then the next after each handler result', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ next: 't' }),
          t: task({ on: { tick: on }, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'tick', payload: 1 })
    h.cmd({ type: 'send', event: 'tick', payload: 2 })
    expect(h.state.inbox).toHaveLength(2)
    const r = h.cmd('next')
    expect(r.types.filter((t) => t.startsWith('event.'))).toEqual(['event.delivered'])
    expect(of(r, 'event.delivered')[0]).toMatchObject({ to: 't', payload: 1 })
    expect(h.state.inbox).toHaveLength(1)
    const again = h.ok(h.call('on', 't'), undefined)
    expect(of(again, 'event.delivered')[0]).toMatchObject({ to: 't', payload: 2 })
    expect(h.state.inbox).toEqual([])
    expect(replay(h)).toEqual(h.state)
  })
})

describe('on — flow-level handlers', () => {
  it('delivered after step-level handlers in the same batch (event.flowDelivered → call flowOn with step ""), not buffered', () => {
    const h = createHarness(
      flow({
        start: 'w',
        steps: { w: wait({ on: { paid: on }, next: 'end' }), end: final() },
        on: { paid: on, other: on },
      }),
    )
    h.start()
    const r = h.cmd({ type: 'send', event: 'paid', payload: { n: 1 } })
    expect(r.types).toEqual(['event.received', 'event.delivered', 'event.flowDelivered'])
    const calls = r.effects.filter((e) => e.kind === 'call')
    expect(calls.map((c) => [c.hook, c.step])).toEqual([
      ['on', 'w'],
      ['flowOn', ''],
    ])
    expect(calls[1]).toMatchObject({
      token: { step: '', runId: 0 },
      extra: { event: 'paid', payload: { n: 1 } },
    })
    // only the flow handles `other`: no buffering, no drop
    const o = h.cmd({ type: 'send', event: 'other', payload: null })
    expect(o.types).toEqual(['event.received', 'event.flowDelivered'])
    expect(h.state.inbox).toEqual([])
    // its void result is silent
    expect(h.ok(h.call('flowOn'), undefined).types).toEqual([])
  })

  it('{ cancel: reason } from the flow-level handler cancels the flow like the cancel command (compensation policy applies)', () => {
    const halt = createHarness(
      flow({
        start: 't',
        steps: { t: task({ next: 'end' }), end: final() },
        on: { abort: on },
      }),
    )
    halt.start()
    halt.cmd({ type: 'send', event: 'abort', payload: null })
    const r = halt.ok(halt.call('flowOn'), { cancel: 'user-abort' })
    expect(r.types).toEqual(['step.cancelled', 'flow.cancelled'])
    expect(of(r, 'flow.cancelled')[0]).toMatchObject({ reason: 'user-abort' })
    expect(halt.state.status).toBe('cancelled')

    const saga = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ compensate: on, next: 'u' }),
          u: task(),
          end: final(),
        },
        policies: { onFailure: 'compensate' },
        on: { abort: on },
      }),
    )
    saga.start()
    saga.ok(saga.call('run', 't'), 1)
    saga.cmd({ type: 'send', event: 'abort', payload: null })
    const c = saga.ok(saga.call('flowOn'), { cancel: 'abort' })
    expect(c.types.slice(0, 2)).toEqual(['flow.compensating', 'step.cancelled'])
    expect(saga.state.status).toBe('compensating')
  })

  it('a throwing flow-level handler is recorded as event.handlerFailed (no step); a late result after the flow ended is stale', () => {
    const h = createHarness(
      flow({
        start: 'w',
        steps: { w: wait({ on: { e: on }, next: 'end' }), end: final() },
        on: { e: on },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'e', payload: 1 })
    const [stepCall, flowCall] = h.pending()
    const r = h.err(flowCall!, 'flow handler bug')
    expect(r.types).toEqual(['event.handlerFailed'])
    expect(of(r, 'event.handlerFailed')[0]).toEqual(
      expect.objectContaining({
        event: 'e',
        error: { name: 'Error', message: 'flow handler bug' },
      }),
    )
    expect(of(r, 'event.handlerFailed')[0]).not.toHaveProperty('step')
    h.ok(stepCall!, undefined)
    expect(h.state.status).toBe('done')
    h.cmd({ type: 'send', event: 'e', payload: 2 }) // rejected: terminal — no call planned
    // a stale flowOn result once terminal
    const stale = h.step({
      type: 'res.ok',
      effectId: 'x',
      hook: 'flowOn',
      token: { step: '', runId: 0 },
      value: { cancel: 'late' },
      durationMs: 0,
    })
    expect(stale.types).toEqual(['result.ignored'])
  })
})

describe('on — resume', () => {
  it('a nav-busy view resumed with buffered events: the transaction is rejected and exactly one entry is drained (one per drain)', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: { v: view({ canExit: yes, on: { ping: on }, next: 'end' }), end: final() },
      }),
    )
    h.start()
    h.cmd('next') // canExit pending → busy
    h.cmd({ type: 'send', event: 'ping', payload: 1 })
    h.cmd({ type: 'send', event: 'ping', payload: 2 })
    expect(h.state.inbox).toHaveLength(2)
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual([
      'flow.resumed',
      'transition.rejected',
      'timer.cleared',
      'event.delivered',
    ])
    expect(of(r, 'event.delivered')[0]).toMatchObject({ to: 'v', payload: 1 })
    expect(h.state.inbox.map((e) => e.payload)).toEqual([2])
    expect(r.effects.filter((e) => e.kind === 'call').map((e) => e.hook)).toEqual(['on'])
    // the second entry follows the first handler result
    const next = h.ok(h.call('on', 'v'), undefined)
    expect(of(next, 'event.delivered')[0]).toMatchObject({ payload: 2 })
    expect(replay(h)).toEqual(h.state)
  })
})

describe('on — correlation', () => {
  const correlated = () =>
    flow({
      start: 'w',
      steps: { w: wait({ on: { paid: on }, next: 'end' }), end: final() },
      correlate: {
        paid: (p) => (p as { orderId?: string }).orderId,
        boom: () => {
          throw new Error('bad extractor')
        },
      },
      on: { boom: on },
    })

  it('a mismatching correlation id drops the event outright (no delivery, no buffering); a match delivers; absent ids do not filter', () => {
    const h = createHarness(correlated(), { correlationId: 'order-1' })
    h.start()
    const drop = h.cmd({ type: 'send', event: 'paid', payload: { orderId: 'order-2' } })
    expect(drop.types).toEqual(['event.received', 'event.dropped'])
    expect(of(drop, 'event.received')[0]?.correlationId).toBe('order-2')
    expect(of(drop, 'event.dropped')[0]).toMatchObject({ event: 'paid', reason: 'correlation' })
    expect(h.state.inbox).toEqual([])
    // no id in the payload → not filtered
    const free = h.cmd({ type: 'send', event: 'paid', payload: {} })
    expect(free.types).toEqual(['event.received', 'event.delivered'])
    h.ok(h.call('on'), { keep: true })
    // match → delivered; the extracted id is recorded on event.received
    const ok = h.cmd({ type: 'send', event: 'paid', payload: { orderId: 'order-1' } })
    expect(ok.types).toEqual(['event.received', 'event.delivered'])
    expect(of(ok, 'event.received')[0]?.correlationId).toBe('order-1')
    // a throwing extractor counts as a mismatch
    const err = h.cmd({ type: 'send', event: 'boom', payload: null })
    expect(err.types).toEqual(['event.received', 'event.dropped'])
  })

  it('a wizard without a correlationId never filters; a caller-provided correlationId is recorded but does not filter', () => {
    const h = createHarness(correlated())
    h.start()
    const r = h.cmd({
      type: 'send',
      event: 'paid',
      payload: { orderId: 'whatever' },
      correlationId: 'caller',
    })
    expect(r.types).toEqual(['event.received', 'event.delivered'])
    expect(of(r, 'event.received')[0]?.correlationId).toBe('caller')
    expect(replay(h)).toEqual(h.state)
  })
})
