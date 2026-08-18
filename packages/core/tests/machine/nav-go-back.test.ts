/**
 * Navigation pipeline (§1) — dynamic `next`, `go` reachability and `back`.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, final, flow, of, task, view } from '../helpers/fixtures'

const linear = () =>
  flow({
    start: 'a',
    steps: {
      a: view({ next: 'b' }),
      b: view({ next: 'c' }),
      c: view({ next: 'end' }),
      end: final(),
    },
  })

describe('nav pipeline — dynamic next, go, back', () => {
  const branching = () =>
    flow({
      start: 'a',
      steps: {
        a: view({ dynamicNext: () => 'b' }),
        b: view({ next: 'c' }),
        c: view({ next: 'end' }),
        d: view({ next: 'end' }),
        end: final(),
      },
    })

  it('dynamic next: call next{extra.output}, then canEnter → commit; null result → no-target', () => {
    const h = createHarness(branching())
    h.start()
    h.cmd({ type: 'setInput', step: 'a', patch: { v: 1 } })
    h.cmd('next')
    expect(h.state.nav.phase).toBe('resolvingTarget')
    const call = h.call('next')
    expect(call).toMatchObject({ step: 'a', extra: { output: { v: 1 } }, token: { txId: 'tx-2' } })
    const r = h.ok(call, 'c')
    expect(r.types).toEqual([
      'transition.phase', // canEnter (targets set)
      'transition.phase', // exiting
      'transition.phase', // entering
      'step.exited',
      'step.arrived',
      'step.entered',
      'transition.committed',
    ])
    expect(of(r, 'transition.phase')[0]).toMatchObject({ phase: 'canEnter', targets: ['c'] })
    expect(h.state.current).toBe('c')

    // back to a, then a null result rejects with no-target
    h.cmd('back')
    expect(h.state.current).toBe('a')
    h.cmd('next')
    const rej = h.ok(h.call('next'), null)
    expect(of(rej, 'transition.rejected')[0]?.reason).toBe('no-target')
    expect(h.state.current).toBe('a')
  })

  it('dynamic next returning an unknown id → transition.failed{UNKNOWN_STEP}', () => {
    const h = createHarness(branching())
    h.start()
    h.cmd('next')
    const r = h.ok(h.call('next'), 'nope')
    expect(of(r, 'transition.failed')[0]).toMatchObject({
      step: 'a',
      error: { code: 'UNKNOWN_STEP' },
    })
  })

  it('dynamic next hook error → transition.failed', () => {
    const h = createHarness(branching())
    h.start()
    h.cmd('next')
    const r = h.err(h.call('next'), 'kaboom')
    expect(of(r, 'transition.failed')[0]?.error.message).toBe('kaboom')
    expect(h.state.nav.phase).toBe('idle')
  })

  it('go: ready or visited views are reachable; others are not; non-views rejected not-a-view', () => {
    const h = createHarness(branching())
    h.start()
    // d is neither ready nor visited
    expect(of(h.cmd({ type: 'go', step: 'd' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    expect(of(h.cmd({ type: 'go', step: 'end' }), 'transition.rejected')[0]?.reason).toBe(
      'not-a-view',
    )
    expect(of(h.cmd({ type: 'go', step: 'a' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    expect(of(h.cmd({ type: 'go', step: 'zzz' }), 'transition.rejected')[0]?.reason).toBe(
      'not-a-view',
    )
    // move a → b → c, then go back to a visited view (a) via go
    h.cmd('next')
    h.ok(h.call('next'), 'b')
    h.cmd('next')
    expect(h.state.current).toBe('c')
    const r = h.cmd({ type: 'go', step: 'a' })
    expect(of(r, 'transition.started')[0]).toMatchObject({ from: 'c', to: 'a', cause: 'go' })
    expect(of(r, 'transition.committed')[0]).toMatchObject({
      from: 'c',
      to: 'a',
      direction: 'forward',
    })
    expect(h.state.current).toBe('a')
    expect(h.rec('c').status).toBe('done')
    expect(h.state.history).toEqual(['a', 'b', 'c', 'a'])
  })

  it('go from the current view to a ready sibling runs the full pipeline (the current view is validated, exited and done)', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['b', 'c'] }),
          b: view({ next: 'end' }),
          c: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next') // fan-out: b becomes current, c stays ready
    expect(h.state.current).toBe('b')
    expect(h.rec('c')).toMatchObject({ pendingActivation: true, status: 'idle' })
    const r = h.cmd({ type: 'go', step: 'c' })
    expect(h.state.current).toBe('c')
    expect(of(r, 'transition.phase').map((p) => p.phase)).toEqual([
      'parsingInput',
      'validating',
      'canExit',
      'resolvingTarget',
      'canEnter',
      'exiting',
      'entering',
    ])
    expect(h.rec('b').status).toBe('done')
  })

  it('back: previous view in history; from → idle (kept input), history pops, no parse/validate/canExit', () => {
    const h = createHarness(linear())
    h.start()
    h.cmd({ type: 'setInput', step: 'a', patch: { n: 1 } })
    h.cmd('next')
    h.cmd({ type: 'setInput', step: 'b', patch: { m: 2 } })
    h.cmd('next')
    expect(h.state.history).toEqual(['a', 'b', 'c'])
    const r = h.cmd('back')
    expect(of(r, 'transition.started')[0]).toMatchObject({ from: 'c', to: 'b', cause: 'back' })
    expect(of(r, 'transition.phase').map((p) => p.phase)).toEqual([
      'canEnter',
      'exiting',
      'entering',
    ])
    expect(of(r, 'step.exited')[0]).toMatchObject({ step: 'c', to: 'b', direction: 'back' })
    expect(h.rec('c').status).toBe('idle')
    expect(h.state.current).toBe('b')
    expect(h.state.history).toEqual(['a', 'b'])
    expect(h.rec('b')).toMatchObject({
      status: 'active',
      input: { m: 2 },
      visitedCount: 2,
      runId: 2,
    })
    // back again to a, then no more history
    h.cmd('back')
    expect(h.state.current).toBe('a')
    expect(of(h.cmd('back'), 'transition.rejected')[0]?.reason).toBe('no-history')
  })

  it('back runs canEnter on the previous view and exit on the current one', () => {
    const calls: string[] = []
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ canEnter: () => true, next: 'b' }),
          b: view({ exit: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('canEnter'), true) // the cursor rule (start) evaluates a's canEnter too
    h.cmd('next')
    h.cmd('back')
    expect(h.state.nav.phase).toBe('canEnter')
    const ce = h.call('canEnter')
    calls.push(ce.step)
    h.ok(ce, true)
    expect(h.state.nav.phase).toBe('exiting')
    const ex = h.call('exit')
    expect(ex).toMatchObject({ step: 'b', extra: { to: 'a', direction: 'back' } })
    h.ok(ex)
    expect(calls).toEqual(['a'])
    expect(h.state.current).toBe('a')
    expect(h.rec('b').status).toBe('idle')
  })

  it('go to a view whose deps are unmet is not reachable (explainable), and becomes reachable when they are met', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t', 'b'] }),
          t: task(),
          b: view({ dependsOn: ['t'], next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    // b arrived but blocked on t; cursor is null; t is running
    expect(h.state.current).toBeNull()
    expect(h.rec('b')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(of(h.cmd({ type: 'go', step: 'b' }), 'transition.rejected')[0]?.reason).toBe(
      'not-reachable',
    )
    // t completes → b ready → cursor rule moves there automatically
    const r = h.ok(h.call('run'), 1)
    expect(h.state.current).toBe('b')
    expect(of(r, 'transition.committed').at(-1)).toMatchObject({
      from: null,
      to: 'b',
      cause: 'auto',
    })
  })
})
