/**
 * Scheduler (§3) — arrival, gating, ordering and the concurrency budget. Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import { explain } from '../../src/machine/index'
import {
  createHarness,
  flow,
  needAll,
  needAny,
  of,
  routingStep,
  runStep,
} from '../helpers/fixtures'

describe('scheduler — arrival, gating, ordering', () => {
  it('start with several entry steps arrives at each; ready tasks enter in arrival order and run in parallel', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: runStep({ next: 'join' }),
          t2: runStep({ next: 'join' }),
          join: runStep({ needs: needAll('t1', 't2'), next: 'end' }),
          end: routingStep(),
        },
      }),
    )
    const r = h.start()
    expect(r.types).toEqual([
      'flow.started',
      'step.arrived',
      'step.arrived',
      'step.entered',
      'step.runStarted',
      'step.entered',
      'step.runStarted',
    ])
    expect(h.state.active).toEqual(['t1', 't2'])
    expect(h.state.status).toBe('running')
    const runs = h.pending('run')
    expect(runs.map((c) => c.step)).toEqual(['t1', 't2'])
    expect(runs[0]?.token).toEqual({ step: 't1', runId: 1, attempt: 1 })
    expect(of(r, 'step.runStarted')[0]).toMatchObject({
      idempotencyKey: 'inst-1:t1:1',
      attempt: 1,
      runId: 1,
    })
  })

  it('plain needs: the join is arrived by the first completion but only enters when every producer is done', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: runStep({ next: 'join' }),
          t2: runStep({ next: 'join' }),
          join: runStep({ needs: needAll('t1', 't2'), next: 'end' }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    const first = h.ok(h.call('run', 't1'), 'a')
    expect(of(first, 'step.arrived').map((e) => e.step)).toEqual(['join'])
    expect(h.rec('join')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(explain(h.def, h.state, 'join').reasons).toEqual(['deps-unmet:t2'])
    const second = h.ok(h.call('run', 't2'), 'b')
    expect(second.types).toContain('step.entered')
    expect(h.rec('join').status).toBe('active')
    expect(h.pending('run', 'join')).toHaveLength(1)
  })

  it('any need: the join enters as soon as one producer is done', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: runStep({ next: 'join' }),
          t2: runStep({ next: 'join' }),
          join: runStep({ needs: needAny('t1', 't2'), next: 'end' }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 't2'), 'b')
    expect(h.rec('join').status).toBe('active')
  })

  it('a routed step is not activated when its needs complete (activation only by its router)', () => {
    const h = createHarness(
      flow({
        start: ['t1', 'route'],
        steps: {
          t1: runStep(),
          route: routingStep({ decide: () => 'end', targets: ['held', 'end'] }),
          held: runStep({ needs: needAll('t1') }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 't1'), 1)
    expect(h.rec('held')).toMatchObject({ status: 'idle', pendingActivation: false })
    expect(explain(h.def, h.state, 'held').reasons).toEqual(['not-activated'])
    h.ok(h.call('next', 'route'), 'end')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.rec('held')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(h.pending('run', 'held')).toHaveLength(0)
  })

  it('concurrency budget: extra ready tasks stay pending and are picked in arrivedSeq order when a slot frees', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2', 't3'],
        steps: {
          t1: runStep({ next: 'end' }),
          t2: runStep({ next: 'end' }),
          t3: runStep({ next: 'end' }),
          end: routingStep({ needs: needAll('t1', 't2', 't3') }),
        },
        policies: { concurrency: 2 },
      }),
    )
    h.start()
    expect(h.state.active).toEqual(['t1', 't2'])
    expect(h.rec('t3')).toMatchObject({ pendingActivation: true, status: 'idle' })
    expect(explain(h.def, h.state, 't3').reasons).toEqual(['concurrency-limit'])
    // finish t2 → t3 enters (only one slot freed)
    const r = h.ok(h.call('run', 't2'), 'x')
    expect(of(r, 'step.entered').map((e) => e.step)).toEqual(['t3'])
    expect(h.state.active).toEqual(['t1', 't3'])
    h.ok(h.call('run', 't1'), 'x')
    h.ok(h.call('run', 't3'), 'x')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
  })

  it('autoRun manual: ready tasks wait for startReady (all) or startStep (one, ignoring the budget)', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2', 't3'],
        steps: {
          t1: runStep({ next: 'end' }),
          t2: runStep({ next: 'end' }),
          t3: runStep({ next: 'end' }),
          end: routingStep({ needs: needAll('t1', 't2', 't3') }),
        },
        policies: { autoRun: 'manual', concurrency: 1 },
      }),
    )
    h.start()
    expect(h.state.active).toEqual([])
    expect(h.state.status).toBe('waiting')
    expect(explain(h.def, h.state, 't1').reasons).toEqual(['auto-run-manual'])
    // run a specific one, ignoring the budget
    h.cmd({ type: 'startStep', step: 't2' })
    h.cmd({ type: 'startStep', step: 't3' })
    expect(h.state.active).toEqual(['t2', 't3'])
    // startReady respects the budget (1) → t1 stays pending
    expect(h.cmd('startReady').types).toEqual([])
    h.ok(h.call('run', 't2'), 1)
    h.ok(h.call('run', 't3'), 1)
    expect(h.state.active).toEqual([])
    h.cmd('startReady')
    expect(h.state.active).toEqual(['t1'])
    // run rejections
    expect(of(h.cmd({ type: 'startStep', step: 't1' }), 'command.rejected')[0]?.code).toBe(
      'NOT_ACTIVE',
    )
    expect(of(h.cmd({ type: 'startStep', step: 'end' }), 'command.rejected')[0]?.code).toBe(
      'NOT_RUNNABLE',
    )
    expect(of(h.cmd({ type: 'startStep', step: 'nope' }), 'command.rejected')[0]?.code).toBe(
      'UNKNOWN_STEP',
    )
  })

  it('a task with an enter hook starts its run only after enter resolves; enter failure fails the step', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: runStep({ enter: () => undefined, next: 'end' }),
          end: routingStep(),
        },
      }),
    )
    const r = h.start()
    expect(r.types).toEqual(['flow.started', 'step.arrived', 'step.entered'])
    expect(of(r, 'step.entered')[0]?.enterPending).toBe(true)
    expect(h.rec('t').entering).toBe(true)
    expect(h.pending('run')).toHaveLength(0)
    const enter = h.call('enter')
    expect(enter.token).toEqual({ step: 't', runId: 1 })
    const done = h.ok(enter)
    expect(done.types).toEqual(['step.enterCompleted', 'step.runStarted'])
    expect(h.rec('t').entering).toBeUndefined()
    expect(h.pending('run')).toHaveLength(1)
  })

  it('enter hook error on a scheduler entry → step.failed{kind:hook} + failure policy', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: runStep({ enter: () => undefined, next: 'end' }), end: routingStep() },
      }),
    )
    h.start()
    const r = h.err(h.call('enter'), 'no entry')
    expect(r.types).toEqual(['step.failed', 'flow.halted'])
    expect(h.rec('t').error).toMatchObject({ kind: 'hook', message: 'no entry' })
    expect(h.state.status).toBe('halted')
  })
})
