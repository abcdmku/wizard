/**
 * v0.2 §10.1 — `on[event]` handlers on every kind, flow-level `on`, correlation.
 * Pure machine tests (decide / apply / plan through the harness).
 */
import { describe, expect, it } from 'vitest'
import {
  createHarness,
  decision,
  final,
  flow,
  flowStep,
  of,
  replay,
  task,
  view,
  wait,
} from '../helpers/fixtures'

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

  it('raw results a kind cannot honour are ignored (reason: kind) — decision / flow / final, a view returning keep / done / fail; a view { next: typo } fails the view (UNKNOWN_STEP)', () => {
    const child = flow({ start: 'end', steps: { end: final() } })
    const h = createHarness(
      flow({
        start: ['v', 'd', 'f', 'z'],
        steps: {
          v: view({ on: { e: on }, next: 'end' }),
          d: decision({ on: { e: on }, decide: () => null }),
          f: flowStep(child, { on: { e: on }, next: 'end' }),
          z: final({ output: on, on: { e: on } }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('childContext', 'f'), {})
    // `d`'s next hook and `z`'s output hook are still pending: every step is active and listening.
    h.cmd({ type: 'send', event: 'e', payload: 1 })
    const results: Record<string, unknown> = {
      v: { keep: true },
      d: { next: 'end' },
      f: 'x',
      z: 42,
    }
    for (const step of ['v', 'd', 'f', 'z']) {
      const r = h.ok(h.call('on', step), results[step])
      expect(r.types).toEqual(['event.handlerResultIgnored'])
      expect(of(r, 'event.handlerResultIgnored')[0]).toMatchObject({
        step,
        event: 'e',
        reason: 'kind',
      })
      expect(h.rec(step).status).toBe('active')
    }
    // `{}` / `{ next: null }` from a view are "nothing"; an unknown target fails the view.
    h.cmd({ type: 'send', event: 'e', payload: 2 })
    expect(h.ok(h.call('on', 'v'), { next: null }).types).toEqual([])
    h.cmd({ type: 'send', event: 'e', payload: 3 })
    const bad = h.ok(h.call('on', 'v'), { next: 'typo' })
    expect(bad.types).toEqual(['step.failed', 'flow.failed'])
    expect(of(bad, 'step.failed')[0]).toMatchObject({
      step: 'v',
      kind: 'hook',
      error: { code: 'UNKNOWN_STEP', message: "unknown next target 'typo'" },
    })
    expect(replay(h)).toEqual(h.state)
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
