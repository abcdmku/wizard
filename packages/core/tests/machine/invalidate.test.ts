/**
 * v0.2 §10.3 — explicit `invalidate` (never automatic). Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import {
  createHarness,
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

const dag = () =>
  flow({
    start: 'a',
    steps: {
      a: view({ next: 'load' }),
      load: task({ compensate: on, next: 'b' }),
      b: view({ dependsOn: ['load'], next: ['t1', 't2'] }),
      t1: task({ dependsOn: ['load'], next: 'join' }),
      t2: task({ next: 'join' }),
      join: task({ dependsOn: ['t1', 't2'], next: 'c' }),
      c: view({ dependsOn: ['join'], next: 'end' }),
      end: final(),
    },
  })

/** Drive the DAG until `c` is current: a → load(done) → b → t1,t2(done) → join(done) → c. */
function toC() {
  const h = createHarness(dag())
  h.start()
  h.cmd({ type: 'setInput', step: 'a', patch: { name: 'x' } })
  h.cmd('next')
  h.ok(h.call('run', 'load'), { rows: 3 })
  expect(h.state.current).toBe('b')
  h.cmd('next')
  h.ok(h.call('run', 't1'), 't1')
  h.ok(h.call('run', 't2'), 't2')
  h.ok(h.call('run', 'join'), 'joined')
  expect(h.state.current).toBe('c')
  return h
}

describe('invalidate', () => {
  it('a done task returns to idle: output → previousOutput, error/issues cleared, saga stack entry kept; without cascade nothing else changes', () => {
    const h = toC()
    const r = h.cmd({ type: 'invalidate', step: 'load', cascade: false })
    expect(r.types).toEqual(['step.invalidated'])
    expect(of(r, 'step.invalidated')[0]).toEqual(
      expect.objectContaining({ step: 'load', cascade: false, cause: 'command' }),
    )
    expect(h.rec('load')).toMatchObject({
      status: 'idle',
      pendingActivation: false,
      previousOutput: { rows: 3 },
      runId: 1,
    })
    expect(h.rec('load').output).toBeUndefined()
    expect(h.state.saga.stack.map((e) => e.step)).toEqual(['load']) // it did complete
    expect(h.rec('t1').status).toBe('done')
    expect(h.rec('b').status).toBe('done')
    expect(h.state.current).toBe('c')
    expect(replay(h)).toEqual(h.state)
  })

  it('cascade (default): every transitive dependsOn dependent that is done/failed/skipped is invalidated too (cause cascade), the current view included when it depends', () => {
    const h = toC()
    const r = h.cmd({ type: 'invalidate', step: 'load' })
    // dependents of load: b (view, done), t1 (done) → join (done) → c (active, current) — t2 does not depend on load
    expect(of(r, 'step.invalidated').map((e) => [e.step, e.cause])).toEqual([
      ['load', 'command'],
      ['b', 'cascade'],
      ['t1', 'cascade'],
      ['join', 'cascade'],
      ['c', 'cascade'],
    ])
    expect(of(r, 'step.cancelled').map((e) => e.step)).toEqual(['c'])
    expect(h.rec('t2').status).toBe('done')
    expect(h.rec('join')).toMatchObject({ status: 'idle', previousOutput: 'joined' })
    expect(h.rec('b')).toMatchObject({ status: 'idle', pendingActivation: false })
    expect(h.state.current).toBeNull()
    expect(h.state.status).toBe('waiting') // nothing active; the user routes again
    // route through again: a is visited → go(a) works and everything re-runs
    h.cmd({ type: 'go', step: 'a' })
    expect(h.state.current).toBe('a')
    expect(h.rec('a').input).toEqual({ name: 'x' }) // draft kept
    h.cmd('next')
    expect(h.rec('load')).toMatchObject({ status: 'active', runId: 2 })
    expect(replay(h)).toEqual(h.state)
  })

  it('a done view keeps its draft input; its output moves to previousOutput; back() can still reach it (visited)', () => {
    const h = toC()
    const r = h.cmd({ type: 'invalidate', step: 'a', cascade: false })
    expect(r.types).toEqual(['step.invalidated'])
    expect(h.rec('a')).toMatchObject({
      status: 'idle',
      input: { name: 'x' },
      previousOutput: { name: 'x' },
      visitedCount: 1,
    })
    expect(h.state.history[0]).toBe('a')
    h.cmd({ type: 'go', step: 'a' })
    expect(h.state.current).toBe('a')
  })

  it('running dependents are cancelled first (a task run aborted, a child flow cancelled), then invalidated', () => {
    const child = flow({ start: 'x', steps: { x: view({ next: 'e' }), e: final() } })
    const h = createHarness(
      flow({
        start: 'seed',
        steps: {
          seed: task({ next: ['t', 'f'] }),
          t: task({ dependsOn: ['seed'] }),
          f: flowStep(child, { dependsOn: ['seed'] }),
          end: final({ dependsOn: ['t', 'f'] }),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 'seed'), 1)
    h.ok(h.call('childContext'), {})
    expect(h.state.active).toEqual(['t', 'f'])
    const run = h.call('run', 't')
    const r = h.cmd({ type: 'invalidate', step: 'seed' })
    expect(r.types).toEqual([
      'step.invalidated',
      'step.cancelled',
      'step.invalidated',
      'step.cancelled',
      'step.invalidated',
    ])
    expect(r.effects.filter((e) => e.kind === 'child.send')).toEqual([
      { kind: 'child.send', step: 'f', command: { type: 'cancel', reason: 'invalidated' } },
    ])
    expect(h.ok(run, 'late').types).toEqual(['result.ignored'])
    expect(h.rec('t')).toMatchObject({ status: 'idle', pendingActivation: false })
    expect(h.rec('f').child).toBeUndefined()
    expect(replay(h)).toEqual(h.state)
  })

  it('rejections: active step, the current view, idle / cancelled steps, unknown ids', () => {
    const h = createHarness(dag())
    h.start()
    h.cmd('next')
    expect(of(h.cmd({ type: 'invalidate', step: 'load' }), 'command.rejected')[0]).toMatchObject({
      code: 'INVALID_COMMAND',
      reason: 'active',
    })
    h.ok(h.call('run', 'load'), 1)
    expect(of(h.cmd({ type: 'invalidate', step: 'b' }), 'command.rejected')[0]).toMatchObject({
      code: 'INVALID_COMMAND',
      reason: 'current-view',
    })
    expect(of(h.cmd({ type: 'invalidate', step: 'join' }), 'command.rejected')[0]).toMatchObject({
      code: 'INVALID_COMMAND',
      reason: 'not-invalidatable:idle',
    })
    expect(of(h.cmd({ type: 'invalidate', step: 'zzz' }), 'command.rejected')[0]?.code).toBe(
      'UNKNOWN_STEP',
    )
  })

  it('invalidating the failed step of a halted flow un-halts it (status recomputed); other done steps stay', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: { v: view({ next: 't' }), t: task({ next: 'end' }), end: final() },
      }),
    )
    h.start()
    h.cmd('next')
    h.err(h.call('run'), 'boom')
    expect(h.state.status).toBe('failed')
    // gated like retry: allowed while halted
    const r = h.cmd({ type: 'invalidate', step: 't' })
    expect(r.types).toEqual(['step.invalidated'])
    expect(h.rec('t')).toMatchObject({ status: 'idle' })
    expect(h.rec('t').error).toBeUndefined()
    expect(h.state.status).toBe('waiting')
    // and the user can route through the failed step again
    expect(of(h.cmd({ type: 'go', step: 'v' }), 'transition.committed')[0]).toMatchObject({
      to: 'v',
      cause: 'go',
    })
    h.cmd('next')
    expect(h.rec('t')).toMatchObject({ status: 'active', runId: 2 })
    h.ok(h.call('run'), 'ok')
    expect(h.state.status).toBe('done')
    expect(replay(h)).toEqual(h.state)
  })

  it('a skipped step can be invalidated (skipReason cleared) and a re-arrival asks `when` again', () => {
    const h = createHarness(
      flow({
        start: 'v',
        steps: {
          v: view({ next: 'w' }),
          w: wait({ when: () => true, on: { e: on }, next: 'v2' }),
          v2: view({ next: 'w' }),
        },
      }),
    )
    h.start()
    h.cmd('next')
    h.ok(h.call('when', 'w'), false)
    expect(h.rec('w')).toMatchObject({ status: 'skipped', skipReason: 'when' })
    expect(h.state.current).toBe('v2')
    expect(h.cmd({ type: 'invalidate', step: 'w' }).types).toEqual(['step.invalidated'])
    expect(h.rec('w').status).toBe('idle')
    expect(h.rec('w').skipReason).toBeUndefined()
    h.cmd('next') // v2 → w: arrives, when asked
    expect(h.rec('w').when).toBe('pending')
  })
})
