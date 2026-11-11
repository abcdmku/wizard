/**
 * D9: deadlines are absolute. A wait timeout or retry that is already due fires before an event
 * is delivered and as soon as a run resumes, whatever the live timer is doing.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, eventStep, flow, of, routingStep, runStep } from '../helpers/fixtures'

const waiting = () =>
  flow({
    start: 'w',
    steps: {
      w: eventStep({
        on: { paid: () => undefined },
        timeout: { afterMs: 1_000, next: 'expired' },
        next: 'end',
      }),
      expired: routingStep(),
      end: routingStep(),
    },
  })

describe('overdue deadlines', () => {
  it('a wait timeout already due beats an event sent after its deadline', () => {
    const h = createHarness(waiting())
    h.start()
    h.clock.advance(5_000)
    const r = h.cmd({ type: 'send', event: 'paid', payload: 1 })
    expect(r.types.slice(0, 2)).toEqual(['timer.fired', 'step.done'])
    expect(h.rec('w').output).toBeUndefined()
    expect(h.rec('end').status).toBe('idle')
    expect(of(r, 'event.delivered')).toEqual([])
    expect(h.pending('on')).toEqual([])
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
  })

  it('overdue wait timeouts and retries fire, in due order, when the run resumes', () => {
    const h = createHarness(
      flow({
        start: ['t', 'w'],
        steps: {
          t: runStep({ retry: { retries: 1, backoff: 2_000 } }),
          w: eventStep({
            on: { paid: () => undefined },
            timeout: { afterMs: 1_000, next: 'late' },
          }),
          late: runStep(),
        },
      }),
    )
    h.start()
    h.err(h.call('run', 't'), 'flaky')
    h.clock.advance(5_000)
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(of(r, 'timer.fired').map((e) => e.timerId)).toEqual(['wait:w', 'retry:t'])
    expect(h.rec('w').output).toBeUndefined()
    expect(h.rec('late').status).toBe('active')
    expect(h.rec('t')).toMatchObject({ status: 'active', attempt: 2 })
  })

  it('an overdue retry runs before an interrupted idempotent run is reissued on resume', () => {
    const h = createHarness(
      flow({
        start: ['a', 'b'],
        steps: {
          a: runStep({ idempotent: true }),
          b: runStep({ retry: { retries: 1, backoff: 2_000 } }),
        },
      }),
    )
    h.start()
    h.err(h.call('run', 'b'), 'flaky')
    h.clock.advance(5_000)
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(of(r, 'step.runStarted').map((e) => [e.step, e.attempt])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
    const calls = r.effects.flatMap((e) => (e.kind === 'call' ? [e.step] : []))
    expect(calls).toEqual(['b', 'a'])
  })
})
