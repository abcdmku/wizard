/**
 * Navigation pipeline (§1.4 / plan §8.3) — fan-out atomicity, cursor rules, auto-advance and the multi-target entry follow-ups.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, decision, final, flow, of, task, view, wait } from '../helpers/fixtures'

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

describe('fan-out atomicity and cursor rules', () => {
  it("one target's canEnter false rejects the whole fan-out (no target arrives)", () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['b', 'c', 'd'] }),
          b: task({ canEnter: () => true }),
          c: view({ canEnter: () => true, next: 'end' }),
          d: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    expect(h.state.nav.pendingSteps).toEqual(['b', 'c'])
    const calls = h.pending('canEnter')
    expect(calls.map((c) => c.step)).toEqual(['b', 'c'])
    h.ok(calls[0]!, true)
    expect(h.state.nav.pendingSteps).toEqual(['c'])
    const r = h.ok(calls[1]!, false)
    expect(of(r, 'transition.rejected')[0]).toMatchObject({ reason: 'guard-canEnter', step: 'c' })
    for (const id of ['b', 'c', 'd']) expect(h.rec(id).pendingActivation).toBe(false)
    expect(h.state.current).toBe('a')
    expect(h.state.active).toEqual(['a'])
  })

  it('all canEnter ok → every target arrives; tasks run in parallel; the first view becomes current', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t1', 'v1', 't2', 'v2'] }),
          t1: task({ canEnter: () => true }),
          t2: task(),
          v1: view({ next: 'end' }),
          v2: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const r = h.ok(h.call('canEnter'), true)
    expect(of(r, 'step.arrived').map((e) => e.step)).toEqual(['t1', 'v1', 't2', 'v2'])
    expect(h.state.current).toBe('v1')
    expect(h.state.active).toEqual(['v1', 't1', 't2'])
    expect(h.rec('v2')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(h.pending('run').map((c) => c.step)).toEqual(['t1', 't2'])
    expect(h.state.status).toBe('running')
  })

  it('cursor rule: with several ready views and no cursor, current stays null (candidates listed by explain)', () => {
    const h = createHarness(
      flow({
        start: ['t'],
        steps: {
          t: task({ next: ['v1', 'v2'] }),
          v1: view({ next: 'end' }),
          v2: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    expect(h.state.current).toBeNull()
    const r = h.ok(h.call('run'), 'ok')
    // auto-advance from t: fan-out to two views; the first view (v1) becomes current
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: 't', to: 'v1', cause: 'auto' })
    expect(h.state.current).toBe('v1')
    expect(h.rec('v2').pendingActivation).toBe(true)
  })

  it('auto-advance chains through non-view steps and stops on a view; hops reset by user commands', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 't1' }),
          t1: task({ next: 't2' }),
          t2: task({ next: 'v' }),
          v: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    expect(h.state.current).toBeNull()
    expect(h.state.status).toBe('running')
    h.ok(h.call('run', 't1'), 1)
    expect(h.state.nav.hops).toBe(1)
    expect(h.pending('run', 't2')).toHaveLength(1)
    const r = h.ok(h.call('run', 't2'), 2)
    expect(h.state.nav.hops).toBe(2)
    expect(of(r, 'transition.committed')[0]).toMatchObject({ from: 't2', to: 'v', cause: 'auto' })
    expect(h.state.current).toBe('v')
    expect(h.state.history).toEqual(['a', 'v'])
    h.cmd('next')
    expect(h.state.status).toBe('done')
  })

  it('AUTO_ADVANCE_LOOP: a decision cycle fails the flow after 1000 hops', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: decision({ decide: () => 'b' }),
          b: decision({ decide: () => 'a' }),
        },
      }),
    )
    h.start()
    let hops = 0
    let last = h.state
    for (let i = 0; i < 1100; i++) {
      const pending = h.pending('next')
      const call = pending[pending.length - 1]
      if (call === undefined) break
      const target = call.step === 'a' ? 'b' : 'a'
      const r = h.ok(call, target)
      last = r.state
      hops++
      if (r.types.includes('flow.failed')) break
    }
    expect(last.status).toBe('failed')
    expect(of(h.log, 'flow.failed')[0]?.code).toBe('AUTO_ADVANCE_LOOP')
    expect(hops).toBeGreaterThan(999)
    expect(hops).toBeLessThan(1010)
  })

  it('hops restart at every external message: a send-driven wait/task loop never trips the guard', () => {
    const h = createHarness(
      flow({
        start: 'w',
        steps: {
          w: wait({ on: { tick: () => undefined }, next: 't' }),
          t: task({ next: 'w' }),
        },
      }),
    )
    h.start()
    for (let i = 0; i < 1200; i++) {
      h.cmd({ type: 'send', event: 'tick', payload: i })
      h.ok(h.call('on'), undefined)
      h.ok(h.call('run'), i)
    }
    expect(h.state.status).toBe('waiting')
    expect(h.state.nav.hops).toBe(2) // w → t → w since the last send
    expect(h.log.some((e) => e.type === 'flow.failed')).toBe(false)
  })

  it('a non-view completion while a transition is in flight is deferred until nav idles', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: ['t', 'v'] }),
          t: task({ next: 'joined' }),
          v: view({ canExit: () => true, next: 'w' }),
          w: view({ next: 'end' }),
          joined: view({ next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next') // t runs, v is current
    h.cmd('next') // v → parsing…canExit (async)
    expect(h.state.nav.phase).toBe('canExit')
    const r = h.ok(h.call('run', 't'), 'x')
    expect(r.types).toEqual(['step.runSucceeded', 'step.done'])
    expect(h.state.nav.deferred).toEqual([{ step: 't' }])
    // the user transition finishes; the deferred auto-advance runs right after the commit
    const c = h.ok(h.call('canExit'), true)
    const started = of(c, 'transition.started')
    expect(started.map((s) => s.cause)).toEqual(['auto'])
    expect(started[0]?.from).toBe('t')
    expect(h.state.nav.deferred).toBeUndefined()
    expect(h.rec('joined').pendingActivation).toBe(true)
    expect(h.state.current).toBe('w')
  })
})

describe('review follow-ups — atomic multi-target entry, go after back', () => {
  it('next() to a task whose enter hook fails: no commit, no successful settle, from stays current', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 't' }),
          t: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const r = h.cmd('next')
    expect(r.types).not.toContain('transition.committed')
    expect(h.state.nav.phase).toBe('entering')
    expect(h.state.nav.pendingSteps).toEqual(['t'])
    expect(h.rec('t').entering).toBe(true)
    expect(r.effects.filter((e) => e.kind === 'settle')).toEqual([])
    const enter = h.call('enter')
    expect(enter).toMatchObject({ step: 't', token: { step: 't', runId: 0 } })
    expect(enter.token.txId).toBeDefined()
    const failed = h.err(enter, 'cannot enter task')
    expect(failed.types).toEqual(['transition.failed'])
    expect(of(failed, 'transition.failed')[0]).toMatchObject({
      step: 't',
      error: { message: 'cannot enter task' },
    })
    expect(failed.effects[0]).toMatchObject({ kind: 'settle', outcome: 'failed' })
    expect(h.state.current).toBe('a')
    expect(h.rec('a').status).toBe('active')
    expect(h.rec('t')).toMatchObject({ status: 'idle', pendingActivation: false, visitedCount: 0 })
    expect(h.rec('t').entering).toBeUndefined()
    expect(h.state.status).toBe('waiting')
    expect(h.pending('run')).toHaveLength(0)
  })

  it('next() to a task whose enter succeeds: commit, then the run starts without a second enter call', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: view({ next: 't' }),
          t: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    const r = h.ok(h.call('enter'))
    expect(r.types).toEqual([
      'step.enterCompleted',
      'step.exited',
      'step.arrived',
      'transition.committed',
      'step.entered',
      'step.runStarted',
    ])
    expect(of(r, 'step.entered')[0]?.enterPending).toBeUndefined()
    expect(h.pending('enter')).toHaveLength(0)
    expect(h.pending('run', 't')).toHaveLength(1)
    expect(h.rec('t')).toMatchObject({ status: 'active', runId: 1, attempt: 1 })
    expect(h.rec('t').enterDone).toBeUndefined()
  })

  it('fan-out with several enter hooks: all must resolve before commit; a late failure enters nothing', () => {
    const mk = () =>
      createHarness(
        flow({
          start: 'a',
          steps: {
            a: view({ next: ['t', 'v', 'w'] }),
            t: task({ enter: () => undefined }),
            v: view({ enter: () => undefined, next: 'end' }),
            w: view({ next: 'end' }),
            end: final(),
          },
        }),
      )
    const ok = mk()
    ok.start()
    ok.cmd('next')
    expect(ok.state.nav.pendingSteps).toEqual(['t', 'v'])
    const [enterT, enterV] = ok.pending('enter')
    expect(ok.ok(enterT!).types).toEqual(['step.enterCompleted'])
    expect(ok.state.nav.phase).toBe('entering')
    expect(ok.rec('t').enterDone).toBe(true)
    const committed = ok.ok(enterV!)
    expect(committed.types).toContain('transition.committed')
    expect(ok.state.current).toBe('v')
    expect(ok.state.active).toEqual(['v', 't'])
    expect(ok.pending('enter')).toHaveLength(0)
    expect(ok.rec('w').pendingActivation).toBe(true)

    const late = mk()
    late.start()
    late.cmd('next')
    const [t2, v2] = late.pending('enter')
    late.ok(t2!)
    const r = late.err(v2!, 'v refused')
    expect(r.types).toEqual(['transition.failed'])
    expect(of(r, 'transition.failed')[0]?.step).toBe('v')
    for (const id of ['t', 'v', 'w']) {
      expect(late.rec(id).status, id).toBe('idle')
      expect(late.rec(id).pendingActivation, id).toBe(false)
      expect(late.rec(id).enterDone, id).toBeUndefined()
      expect(late.rec(id).entering, id).toBeUndefined()
    }
    expect(late.state.current).toBe('a')
    expect(late.state.active).toEqual(['a'])
  })

  it('auto-advance targets (from a completed task) still enter through the scheduler sub-phase', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ next: 'u' }),
          u: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    const r = h.ok(h.call('run', 't'), 1)
    expect(r.types).toContain('transition.committed')
    expect(of(r, 'step.entered').at(-1)).toMatchObject({ step: 'u', enterPending: true })
    const done = h.ok(h.call('enter'))
    expect(done.types).toEqual(['step.enterCompleted', 'step.runStarted'])
    // a scheduler-entry enter failure fails the step (policy), not a transaction
    const h2 = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ next: 'u' }),
          u: task({ enter: () => undefined, next: 'end' }),
          end: final(),
        },
      }),
    )
    h2.start()
    h2.ok(h2.call('run', 't'), 1)
    expect(h2.err(h2.call('enter'), 'no').types).toEqual(['step.failed', 'flow.failed'])
  })

  it('A → B → C → back to B → go(C): C is reachable because it was visited (history is only the back-stack)', () => {
    const h = createHarness(linear())
    h.start()
    h.cmd('next')
    h.cmd('next')
    expect(h.state.current).toBe('c')
    h.cmd('back')
    expect(h.state.current).toBe('b')
    expect(h.state.history).toEqual(['a', 'b'])
    const r = h.cmd({ type: 'go', step: 'c' })
    expect(r.types).toContain('transition.committed')
    expect(h.state.current).toBe('c')
    expect(h.state.history).toEqual(['a', 'b', 'c'])
    expect(h.rec('c').visitedCount).toBe(2)
  })
})
