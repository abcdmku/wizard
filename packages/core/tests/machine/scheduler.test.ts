/**
 * Scheduler (§3) — arrival, gating, ordering and the concurrency budget. Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import { explain } from '../../src/machine/index'
import { createHarness, final, flow, of, task } from '../helpers/fixtures'

describe('scheduler — arrival, gating, ordering', () => {
  it('start with several entry steps arrives at each; ready tasks enter in arrival order and run in parallel', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'join' }),
          t2: task({ next: 'join' }),
          join: task({ dependsOn: ['t1', 't2'], next: 'end' }),
          end: final(),
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

  it('dependsOn (all): the join is arrived by the first completion but only enters when every dep is done', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'join' }),
          t2: task({ next: 'join' }),
          join: task({ dependsOn: ['t1', 't2'], next: 'end' }),
          end: final(),
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

  it('dependsOn (any): the join enters as soon as one dep is done', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2'],
        steps: {
          t1: task({ next: 'join' }),
          t2: task({ next: 'join' }),
          join: task({ dependsOn: { any: ['t1', 't2'] }, next: 'end' }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 't2'), 'b')
    expect(h.rec('join').status).toBe('active')
  })

  it('a step with dependsOn but no arrival never activates when its deps complete (activation only by arrival)', () => {
    const h = createHarness(
      flow({
        start: 't1',
        steps: {
          t1: task({ next: 'end' }),
          orphan: task({ dependsOn: ['t1'] }),
          end: final(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 't1'), 1)
    expect(h.state.status).toBe('done')
    expect(h.rec('orphan')).toMatchObject({ status: 'idle', pendingActivation: false })
    expect(explain(h.def, h.state, 'orphan').reasons).toContain('not-activated')
  })

  it('concurrency budget: extra ready tasks stay pending and are picked in arrivedSeq order when a slot frees', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2', 't3'],
        steps: {
          t1: task({ next: 'end' }),
          t2: task({ next: 'end' }),
          t3: task({ next: 'end' }),
          end: final({ dependsOn: ['t1', 't2', 't3'] }),
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
    expect(h.state.status).toBe('done')
  })

  it('autoRun manual: ready tasks wait for runReady (all) or run{step} (one, ignoring the budget)', () => {
    const h = createHarness(
      flow({
        start: ['t1', 't2', 't3'],
        steps: {
          t1: task({ next: 'end' }),
          t2: task({ next: 'end' }),
          t3: task({ next: 'end' }),
          end: final({ dependsOn: ['t1', 't2', 't3'] }),
        },
        policies: { autoRun: 'manual', concurrency: 1 },
      }),
    )
    h.start()
    expect(h.state.active).toEqual([])
    expect(h.state.status).toBe('waiting')
    expect(explain(h.def, h.state, 't1').reasons).toEqual(['auto-run-manual'])
    // run a specific one, ignoring the budget
    h.cmd({ type: 'run', step: 't2' })
    h.cmd({ type: 'run', step: 't3' })
    expect(h.state.active).toEqual(['t2', 't3'])
    // runReady respects the budget (1) → t1 stays pending
    expect(h.cmd('runReady').types).toEqual([])
    h.ok(h.call('run', 't2'), 1)
    h.ok(h.call('run', 't3'), 1)
    expect(h.state.active).toEqual([])
    h.cmd('runReady')
    expect(h.state.active).toEqual(['t1'])
    // run rejections
    expect(of(h.cmd({ type: 'run', step: 't1' }), 'command.rejected')[0]?.code).toBe('NOT_ACTIVE')
    expect(of(h.cmd({ type: 'run', step: 'end' }), 'command.rejected')[0]?.code).toBe('NOT_A_TASK')
    expect(of(h.cmd({ type: 'run', step: 'nope' }), 'command.rejected')[0]?.code).toBe(
      'UNKNOWN_STEP',
    )
  })

  it('a task with an enter hook starts its run only after enter resolves; enter failure fails the step', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: task({ enter: () => undefined, next: 'end' }),
          end: final(),
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
        steps: { t: task({ enter: () => undefined, next: 'end' }), end: final() },
      }),
    )
    h.start()
    const r = h.err(h.call('enter'), 'no entry')
    expect(r.types).toEqual(['step.failed', 'flow.failed'])
    expect(h.rec('t').error).toMatchObject({ kind: 'hook', message: 'no entry' })
    expect(h.state.status).toBe('failed')
  })
})
