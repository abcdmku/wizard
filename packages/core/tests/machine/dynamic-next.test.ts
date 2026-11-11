/**
 * A dynamic `next` that names an unknown step, or throws, fails its step under the flow's
 * failure policy instead of letting the run finish `done`.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, flow, of, routingStep, runStep } from '../helpers/fixtures'

const routed = () =>
  createHarness(
    flow({
      start: 'a',
      steps: { a: runStep({ dynamicNext: () => null, targets: ['b'] }), b: routingStep() },
    }),
  )

describe('dynamic next failures', () => {
  it('an unknown target fails the step (halted), and retry recovers', () => {
    const h = routed()
    h.start()
    h.ok(h.call('run'))
    const r = h.ok(h.call('next'), 'nope')
    expect(r.types).toEqual(['transition.failed', 'step.failed', 'run.halted'])
    expect(of(r, 'step.failed')[0]).toMatchObject({
      step: 'a',
      kind: 'hook',
      error: { code: 'UNKNOWN_STEP', message: "unknown next target 'nope'" },
    })
    expect(h.state.status).toBe('halted')

    h.cmd({ type: 'retry', step: 'a' })
    h.ok(h.call('run'))
    h.ok(h.call('next'), 'b')
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
  })

  it('a throwing next fails the step under the compensate policy too', () => {
    const def = flow({
      start: 'a',
      steps: { a: runStep({ dynamicNext: () => null, targets: ['b'] }), b: routingStep() },
      policies: { onFailure: 'compensate' },
    })
    const h = createHarness(def)
    h.start()
    h.ok(h.call('run'))
    const r = h.err(h.call('next'), 'route exploded')
    expect(of(r, 'step.failed')[0]).toMatchObject({
      step: 'a',
      error: { message: 'route exploded' },
    })
    expect(of(r, 'run.done')).toHaveLength(0)
    expect(h.state.status).toBe('failed')
  })
})
