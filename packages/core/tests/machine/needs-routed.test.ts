/**
 * A declared target of a function `next` is routed: only that choice activates it, and its needs
 * hold it. A target that was not chosen is never started by a need.
 */
import { describe, expect, it } from 'vitest'
import { explain } from '../../src/machine/explain'
import {
  createHarness,
  flow,
  needAll,
  needOptional,
  of,
  replay,
  routingStep,
  runStep,
} from '../helpers/fixtures'

describe('needs on routed steps', () => {
  const routed = (route: ReturnType<typeof runStep>) =>
    flow({
      start: ['audit', 'route'],
      steps: {
        audit: runStep(),
        route,
        ship: runStep({ needs: needAll('route', 'audit') }),
        cancel: runStep(),
      },
    })
  const chooses = (target: string) =>
    routingStep({ decide: () => target, targets: ['ship', 'cancel'] })
  const shipRuns = (h: ReturnType<typeof createHarness>) =>
    h.effects.filter((e) => e.kind === 'call' && e.step === 'ship' && e.hook === 'run')

  it('never starts a not-taken target when its needs complete after the choice', () => {
    const h = createHarness(routed(chooses('cancel')))
    h.start()
    h.ok(h.call('next', 'route'), 'cancel')
    expect(h.rec('ship')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    h.ok(h.call('run', 'cancel'), 'cancelled')
    const audited = h.ok(h.call('run', 'audit'), 'clean')
    expect(of(audited, 'step.arrived')).toEqual([])
    expect(h.rec('ship')).toMatchObject({
      status: 'skipped',
      skipReason: 'not-taken',
      pendingActivation: false,
    })
    expect(explain(h.def, h.state, 'ship').reasons).toEqual(['not-activated', 'skipped:not-taken'])
    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(of(resumed, 'step.arrived')).toEqual([])
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.rec('ship')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(shipRuns(h)).toEqual([])
    expect(replay(h)).toEqual(h.state)
  })

  it('never starts a not-taken target whose needs completed before the choice', () => {
    const h = createHarness(routed(chooses('cancel')))
    h.start()
    const audited = h.ok(h.call('run', 'audit'), 'clean')
    expect(of(audited, 'step.arrived')).toEqual([])
    expect(h.rec('ship')).toMatchObject({ status: 'idle', pendingActivation: false })
    expect(explain(h.def, h.state, 'ship').reasons).toEqual(['not-activated', 'deps-unmet:route'])
    h.ok(h.call('next', 'route'), 'cancel')
    expect(h.rec('ship')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    h.ok(h.call('run', 'cancel'), 'cancelled')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(shipRuns(h)).toEqual([])
  })

  it('does not start a target between its router finishing its work and choosing', () => {
    const h = createHarness(
      routed(runStep({ dynamicNext: () => 'cancel', targets: ['ship', 'cancel'] })),
    )
    h.start()
    h.ok(h.call('run', 'audit'), 'clean')
    h.ok(h.call('run', 'route'), 'reviewed')
    expect(h.rec('route').status).toBe('done')
    expect(h.pending('next', 'route')).toHaveLength(1)
    expect(h.rec('ship')).toMatchObject({ status: 'idle', pendingActivation: false })
    h.ok(h.call('next', 'route'), 'cancel')
    expect(h.rec('ship')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(shipRuns(h)).toEqual([])
  })

  it('holds a chosen target until its needs are met', () => {
    const h = createHarness(routed(chooses('ship')))
    h.start()
    h.ok(h.call('next', 'route'), 'ship')
    expect(h.rec('ship')).toMatchObject({ status: 'idle', pendingActivation: true })
    expect(explain(h.def, h.state, 'ship').reasons).toEqual(['deps-unmet:audit'])
    expect(h.rec('cancel')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    h.ok(h.call('run', 'audit'), 'clean')
    expect(h.rec('ship').status).toBe('active')
    h.ok(h.call('run', 'ship'), 'shipped')
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: 'shipped' })
    expect(shipRuns(h)).toHaveLength(1)
    expect(replay(h)).toEqual(h.state)
  })

  it('skips a target with needs when the router that could choose it is not taken', () => {
    const h = createHarness(
      flow({
        start: ['audit', 'outer'],
        steps: {
          audit: runStep(),
          outer: routingStep({ decide: () => 'stop', targets: ['inner', 'stop'] }),
          inner: routingStep({ decide: () => 'ship', targets: ['ship'] }),
          ship: runStep({ needs: needAll('audit') }),
          stop: runStep(),
          report: runStep({ needs: needOptional('ship') }),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 'audit'), 'clean')
    h.ok(h.call('next', 'outer'), 'stop')
    expect(h.rec('inner')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(h.rec('ship')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(h.rec('report').status).toBe('active')
    h.ok(h.call('run', 'stop'), 'stopped')
    h.ok(h.call('run', 'report'), 'reported')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(shipRuns(h)).toEqual([])
  })
})
