/**
 * (d) compensation with the REAL machine: three compensatable tasks then a
 * failing fourth → compensation order [3, 2, 1]; a throwing compensate hook
 * (#2) → `saga.failures`; `compensate({ from })` retries only that entry;
 * `cancel()` during a run aborts and compensates.
 */

import { describe, expect, it } from 'vitest'
import type { WizardState } from '../../../src/machine/state'
import { final, flow, task } from '../../helpers/fixtures'
import { e2e, tick } from './harness'

function sagaFlow(opts: { failCompensate2?: () => boolean; asyncRun4?: boolean } = {}) {
  const compensated: string[] = []
  const def = flow({
    name: 'saga',
    start: 't1',
    policies: { onFailure: 'compensate' },
    steps: {
      t1: task({ run: () => 'r1', compensate: () => void compensated.push('t1'), next: 't2' }),
      t2: task({
        run: () => 'r2',
        compensate: () => {
          if (opts.failCompensate2?.() === true) throw new Error('undo t2 failed')
          compensated.push('t2')
        },
        next: 't3',
      }),
      t3: task({
        run: () => 'r3',
        compensate: ({ output }) => void compensated.push(`t3:${String(output)}`),
        next: 't4',
      }),
      t4: task({
        run: () => {
          if (opts.asyncRun4 === true) return new Promise(() => {})
          throw new Error('t4 exploded')
        },
        next: 'end',
      }),
      end: final(),
    },
  })
  return { def, compensated }
}

describe('e2e saga: compensation order, partial failure, retry, cancel', () => {
  it('unwinds in reverse completion order [3,2,1] and ends with flow.compensated{failed}', async () => {
    const { def, compensated } = sagaFlow()
    const t = e2e(def)
    await t.wizard.start()
    const s: WizardState = t.wizard.getState()
    expect(compensated).toEqual(['t1', 't2', 't3:r3'].reverse())
    expect(s.status).toBe('failed')
    expect(t.rec('t4')).toMatchObject({
      status: 'failed',
      error: { kind: 'run', message: 't4 exploded' },
    })
    for (const id of ['t1', 't2', 't3']) expect(t.rec(id).status).toBe('compensated')
    expect(s.saga.compensated).toEqual([
      { step: 't3', runId: 1 },
      { step: 't2', runId: 1 },
      { step: 't1', runId: 1 },
    ])
    expect(s.saga.stack.map((e) => [e.step, e.runId, e.output])).toEqual([
      ['t1', 1, 'r1'],
      ['t2', 1, 'r2'],
      ['t3', 1, 'r3'],
    ])
    expect(s.saga.failures).toEqual([])
    const order = t.types()
    const started = t.of('step.compensationStarted').map((e) => e.step)
    expect(started).toEqual(['t3', 't2', 't1'])
    expect(order.indexOf('flow.compensating')).toBeLessThan(
      order.indexOf('step.compensationStarted'),
    )
    expect(t.of('flow.compensating')[0]).toMatchObject({
      plan: ['t3', 't2', 't1'],
      outcome: 'failed',
    })
    expect(t.of('flow.compensated')[0]).toMatchObject({ failures: [], outcome: 'failed' })
    // Everything after is rejected as a value.
    expect(await t.wizard.next()).toMatchObject({ ok: false })
    expect(await t.wizard.retry('t4')).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
  })

  it('a throwing compensate hook is recorded in saga.failures and the unwind continues; compensate({from}) retries only it', async () => {
    let failT2 = true
    const { def, compensated } = sagaFlow({ failCompensate2: () => failT2 })
    const t = e2e(def)
    await t.wizard.start()
    expect(compensated).toEqual(['t3:r3', 't1'])
    expect(t.rec('t2')).toMatchObject({
      status: 'failed',
      error: { kind: 'compensate', message: 'undo t2 failed' },
    })
    expect(t.wizard.getState().saga.failures).toEqual([{ step: 't2', runId: 1 }])
    expect(t.of('step.compensationFailed')[0]).toMatchObject({
      step: 't2',
      error: { message: 'undo t2 failed' },
    })
    expect(t.of('flow.compensated')[0]?.failures.length).toBe(1)
    expect(t.wizard.getState().status).toBe('failed')

    // Retry only t2.
    failT2 = false
    t.clear()
    expect(await t.wizard.compensate({ from: 't2' })).toMatchObject({ ok: true })
    expect(compensated).toEqual(['t3:r3', 't1', 't2'])
    expect(t.of('step.compensationStarted').map((e) => e.step)).toEqual(['t2'])
    expect(t.rec('t2').status).toBe('compensated')
    expect(t.wizard.getState().saga.failures).toEqual([])
    expect(t.of('flow.compensated')[0]).toMatchObject({ failures: [] })
    // Nothing left to compensate → the flow is terminal for further compensate commands.
    expect(await t.wizard.compensate({ from: 't3' })).toMatchObject({
      ok: false,
      code: 'FLOW_TERMINAL',
    })
  })

  it('cancel() during an in-flight run aborts it, waits for it to settle, then compensates (outcome cancelled)', async () => {
    const { def, compensated } = sagaFlow({ asyncRun4: true })
    const t = e2e(def, { abortGraceMs: 1_000 })
    await t.wizard.start()
    expect(t.rec('t4').status).toBe('active')
    expect(await t.wizard.cancel('user')).toMatchObject({ ok: true })
    // Phase 1: the run is cancelled and settling; nothing unwound yet.
    expect(t.rec('t4').status).toBe('cancelled')
    expect(t.wizard.getState().status).toBe('compensating')
    expect(t.wizard.getState().saga.settling).toEqual(['t4'])
    expect(compensated).toEqual([])
    // The hook never settles cooperatively → the interpreter's grace timer settles it.
    t.sched.advance(1_000)
    await tick()
    expect(t.wizard.getState().saga.settling ?? []).toEqual([])
    expect(compensated).toEqual(['t3:r3', 't2', 't1'])
    expect(t.of('flow.compensated')[0]).toMatchObject({ outcome: 'cancelled' })
    expect(t.wizard.getState().status).toBe('cancelled')
  })
})
