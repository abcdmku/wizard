import { describe, expect, it } from 'vitest'
import { waitingFor } from '../../src/machine/waiting-for'
import { createHarness, flow, flowStep, of, replay, runStep } from '../helpers/fixtures'

describe('durable sleeps', () => {
  it('resumes an overdue sleep at its original deadline before starting its successor', () => {
    const h = createHarness(
      flow({
        start: 'delay',
        steps: {
          delay: { ...runStep({ next: 'after' }), hooks: {}, sleep: 100 },
          after: runStep(),
        },
      }),
    )
    h.start()
    expect(h.rec('delay').deadline).toBe(1100)
    expect(waitingFor(h.def, h.state)).toEqual([
      { kind: 'sleep', path: [], step: 'delay', deadline: 1100 },
    ])
    h.clock.advance(150)
    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(of(resumed, 'timer.fired').map((event) => event.timerId)).toEqual(['sleep:delay'])
    expect(h.rec('delay').status).toBe('done')
    expect(h.rec('delay').output).toBeUndefined()
    expect(h.rec('after').status).toBe('active')
    expect(h.state.timers).toEqual({})
    expect(h.pending('run', 'after')).toHaveLength(1)
    expect(replay(h)).toEqual(h.state)
  })

  it('evaluates a dynamic duration once and rearms the stored future timer', () => {
    const h = createHarness(
      flow({
        start: 'delay',
        steps: { delay: { ...runStep(), hooks: {}, sleep: () => 100 } },
      }),
    )
    h.start()
    h.ok(h.call('sleep'), 100)
    h.clock.advance(30)
    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(h.rec('delay').deadline).toBe(1100)
    expect(resumed.effects.filter((effect) => effect.kind === 'call')).toEqual([])
    expect(resumed.effects).toContainEqual({
      kind: 'timer.set',
      timerId: 'sleep:delay',
      at: 1100,
      fire: { type: 'timer.fired', timerId: 'sleep:delay' },
    })
    h.fire('sleep:delay')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
  })

  it('finishes a zero delay without scheduling a timer, and rejects an invalid hook duration', () => {
    const zero = createHarness(
      flow({ start: 'delay', steps: { delay: { ...runStep(), hooks: {}, sleep: 0 } } }),
    )
    zero.start()
    zero.step({ type: 'settle' })
    expect(zero.state.status).toBe('done')
    expect(zero.state.timers).toEqual({})
    const bad = createHarness(
      flow({ start: 'delay', steps: { delay: { ...runStep(), hooks: {}, sleep: () => 1 } } }),
    )
    bad.start()
    bad.ok(bad.call('sleep'), Number.NaN)
    expect(bad.state.status).toBe('halted')
    expect(bad.rec('delay').error?.code).toBe('INVALID_SLEEP')
  })
})

describe('static failure fallback', () => {
  it('waits for retry exhaustion and retains the failure while continuing under compensate policy', () => {
    const h = createHarness(
      flow({
        start: 'request',
        policies: { onFailure: 'compensate' },
        steps: {
          request: { ...runStep({ retry: { retries: 1 } }), fallback: 'recover' },
          recover: runStep(),
        },
      }),
    )
    h.start()
    h.err(h.call('run', 'request'), 'first')
    expect(h.rec('request').status).toBe('active')
    h.fire('retry:request')
    h.err(h.call('run', 'request'), 'last')
    expect(h.rec('request')).toMatchObject({
      status: 'skipped',
      skipReason: 'fallback',
      error: { message: 'last', kind: 'run', attempt: 2 },
    })
    expect(h.rec('recover').status).toBe('active')
    expect(h.log.some((event) => event.type === 'run.compensating')).toBe(false)
    h.ok(h.call('run', 'recover'), 'recovered')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.state.output).toBe('recovered')
    expect(replay(h)).toEqual(h.state)
  })

  it('retains the actual child failure and handles halted children through fallback', () => {
    const child = flow({ start: 'work', steps: { work: runStep() } })
    const h = createHarness(
      flow({
        start: 'child',
        steps: { child: { ...flowStep(child), fallback: 'recover' }, recover: runStep() },
      }),
    )
    h.start()
    h.child(
      'child',
      { status: 'halted' },
      { failed: { error: { name: 'Error', message: 'child broke' } } },
    )
    expect(h.rec('child')).toMatchObject({
      status: 'skipped',
      skipReason: 'fallback',
      error: { message: 'child broke', kind: 'child' },
    })
    expect(h.rec('recover').status).toBe('active')
  })

  it('keeps a happy-path step as a sink when it has a fallback edge', () => {
    const h = createHarness(
      flow({
        start: 'request',
        steps: { request: { ...runStep(), fallback: 'recover' }, recover: runStep() },
      }),
    )
    h.start()
    h.ok(h.call('run'), 'success')
    h.step({ type: 'settle' })
    expect(h.rec('recover').status).toBe('idle')
    expect(h.state.status).toBe('done')
    expect(h.state.output).toBe('success')
  })
})
