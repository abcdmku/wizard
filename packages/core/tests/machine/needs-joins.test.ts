import { describe, expect, it } from 'vitest'
import type { CompiledWizard } from '../../src/authoring/compiled'
import { explain } from '../../src/machine/explain'
import { needsSatisfied } from '../../src/machine/needs'
import { progress } from '../../src/machine/selectors'
import {
  createHarness,
  eventStep,
  flow,
  of,
  replay,
  routingStep,
  runStep,
  view,
} from '../helpers/fixtures'

function dataFlow(
  def: CompiledWizard,
  feeds: CompiledWizard['feeds'],
  sinks: CompiledWizard['sinks'] = ['join'],
): CompiledWizard {
  return { ...def, feeds, sinks }
}

describe('needs data joins', () => {
  it('pulls a join after every required output completes without producer next edges', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: ['a', 'b'],
          steps: {
            a: runStep(),
            b: runStep(),
            join: {
              ...runStep(),
              needs: {
                first: { kind: 'all', steps: ['a'] },
                second: { kind: 'all', steps: ['b'] },
              },
            },
          },
        }),
        { a: ['join'], b: ['join'] },
      ),
    )
    h.start()
    const first = h.ok(h.call('run', 'a'), 3)
    expect(of(first, 'step.arrived').map((event) => event.step)).toEqual(['join'])
    expect(h.rec('join')).toMatchObject({ status: 'idle', pendingActivation: true })
    expect(explain(h.def, h.state, 'join').reasons).toEqual(['deps-unmet:b'])
    const completed = h.ok(h.call('run', 'b'), 4)
    expect(of(completed, 'step.arrived')).toEqual([])
    expect(h.rec('join').status).toBe('active')
    h.ok(h.call('run', 'join'), 7)
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: 7 })
    expect(replay(h)).toEqual(h.state)
  })

  it('halts a partial pull join when a required producer never activates', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: 'a',
          steps: {
            a: runStep(),
            b: runStep(),
            join: {
              ...runStep(),
              needs: {
                a: { kind: 'all', steps: ['a'] },
                b: { kind: 'all', steps: ['b'] },
              },
            },
          },
        }),
        { a: ['join'], b: ['join'] },
      ),
    )
    h.start()
    h.ok(h.call('run', 'a'), 3)
    const settled = h.step({ type: 'settle' })
    expect(h.state.status).toBe('halted')
    expect(h.rec('join')).toMatchObject({
      status: 'failed',
      error: {
        code: 'DEPS_UNREACHABLE',
        message: "step 'join' waits on 'b', which can no longer complete",
      },
    })
    expect(of(settled, 'run.done')).toEqual([])
    expect(h.rec('b')).toMatchObject({ status: 'idle', visitedCount: 0 })
    h.cmd({ type: 'skip', step: 'join' })
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.state.output).toBeUndefined()
    expect(replay(h)).toEqual(h.state)
  })

  it('skips required consumers transitively when a producer is skipped', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: 'source',
          steps: {
            source: runStep({ when: () => false }),
            join: { ...runStep(), needs: { source: { kind: 'all', steps: ['source'] } } },
            sink: { ...runStep(), needs: { join: { kind: 'all', steps: ['join'] } } },
          },
        }),
        { source: ['join'], join: ['sink'] },
        ['sink'],
      ),
    )
    h.start()
    const skipped = h.ok(h.call('when', 'source'), false)
    expect(of(skipped, 'step.skipped').map((event) => [event.step, event.reason])).toEqual([
      ['source', 'when'],
      ['join', 'needs-skipped'],
      ['sink', 'needs-skipped'],
    ])
    expect(h.pending('run')).toEqual([])
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.state.output).toBeUndefined()
  })

  it('any needs wait past skipped producers and start once on the first actual output', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: ['a', 'b', 'c'],
          steps: {
            a: runStep({ when: () => false }),
            b: runStep(),
            c: runStep(),
            join: { ...runStep(), needs: { winner: { kind: 'any', steps: ['a', 'b', 'c'] } } },
          },
        }),
        { a: ['join'], b: ['join'], c: ['join'] },
      ),
    )
    h.start()
    h.ok(h.call('when', 'a'), false)
    expect(h.rec('join').status).toBe('idle')
    h.ok(h.call('run', 'c'), 'first')
    h.ok(h.call('run', 'join'), 'winner')
    h.ok(h.call('run', 'b'), 'later')
    expect(h.rec('join')).toMatchObject({ status: 'done', visitedCount: 1, output: 'winner' })
    expect(
      h.effects.filter(
        (effect) => effect.kind === 'call' && effect.step === 'join' && effect.hook === 'run',
      ),
    ).toHaveLength(1)
  })

  it('any needs skip only after every producer is skipped', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: ['a', 'b'],
          steps: {
            a: runStep({ when: () => false }),
            b: runStep({ when: () => false }),
            join: { ...runStep(), needs: { winner: { kind: 'any', steps: ['a', 'b'] } } },
          },
        }),
        { a: ['join'], b: ['join'] },
      ),
    )
    h.start()
    h.ok(h.call('when', 'a'), false)
    expect(h.rec('join').status).toBe('idle')
    h.ok(h.call('when', 'b'), false)
    expect(h.rec('join')).toMatchObject({ status: 'skipped', skipReason: 'needs-skipped' })
  })

  it('optional needs wait for settlement and never propagate a skipped producer', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: 'source',
          steps: {
            source: runStep({ when: () => false }),
            join: { ...runStep(), needs: { source: { kind: 'optional', steps: ['source'] } } },
          },
        }),
        { source: ['join'] },
      ),
    )
    h.start()
    expect(h.rec('join')).toMatchObject({ status: 'idle', pendingActivation: false })
    h.ok(h.call('when', 'source'), false)
    expect(h.rec('join')).toMatchObject({ status: 'active' })
    expect(h.call('run', 'join').step).toBe('join')
  })

  it('optional needs also accept failed and cancelled producers as absent outputs', () => {
    const def = dataFlow(
      flow({
        start: 'source',
        steps: {
          source: runStep(),
          join: { ...runStep(), needs: { source: { kind: 'optional', steps: ['source'] } } },
        },
      }),
      { source: ['join'] },
    )
    const h = createHarness(def)
    h.start()
    h.err(h.call('run', 'source'), 'unavailable')
    expect(needsSatisfied(def, h.state, 'join')).toBe(true)
    const cancelled = {
      ...h.state,
      steps: { ...h.state.steps, source: { ...h.rec('source'), status: 'cancelled' as const } },
    }
    expect(needsSatisfied(def, cancelled, 'join')).toBe(true)
  })

  it('propagates branch exclusions through static successors and skips a required join', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: 'gate',
          steps: {
            gate: { ...routingStep(), next: { kind: 'dynamic', targets: ['a', 'b'] } },
            a: runStep(),
            b: runStep({ next: 'b2' }),
            b2: runStep(),
            join: {
              ...runStep(),
              needs: {
                a: { kind: 'all', steps: ['a'] },
                b2: { kind: 'all', steps: ['b2'] },
              },
            },
            optional: { ...runStep(), needs: { b2: { kind: 'optional', steps: ['b2'] } } },
          },
        }),
        { a: ['join'], b2: ['join', 'optional'] },
        ['join', 'optional'],
      ),
    )
    h.start()
    h.ok(h.call('next', 'gate'), 'a')
    expect(h.rec('b')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(h.rec('b2')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(h.rec('join')).toMatchObject({ status: 'skipped', skipReason: 'needs-skipped' })
    expect(h.rec('optional').status).toBe('active')
    h.ok(h.call('run', 'a'), 1)
    h.ok(h.call('run', 'optional'), 'absent')
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: 'absent' })
  })

  it('revives a skipped join when an alternate timeout later completes its producer', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: 'gate',
          steps: {
            gate: {
              ...routingStep(),
              next: { kind: 'dynamic', targets: ['approve', 'quarantine'] },
            },
            approve: eventStep({
              on: { approved: () => ({ done: true }) },
              timeout: { afterMs: 10, next: 'quarantine' },
            }),
            quarantine: runStep(),
            join: { ...runStep(), needs: { quarantine: { kind: 'all', steps: ['quarantine'] } } },
          },
        }),
        { quarantine: ['join'] },
      ),
    )
    h.start()
    h.ok(h.call('next', 'gate'), 'approve')
    expect(h.rec('join')).toMatchObject({ status: 'skipped', skipReason: 'needs-skipped' })
    h.clock.advance(10)
    h.fire('wait:approve')
    expect(h.rec('quarantine').status).toBe('active')
    h.ok(h.call('run', 'quarantine'), 'recovered')
    expect(h.rec('join').status).toBe('active')
    h.ok(h.call('run', 'join'), 'joined')
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: 'joined' })
  })

  it('keeps invalidated work navigable until it completes again, even with undefined output', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: 'form',
          steps: { form: view({ next: 'source' }), source: runStep() },
        }),
        {},
        ['source'],
      ),
    )
    h.start()
    h.cmd('next')
    h.ok(h.call('run', 'source'))
    h.cmd({ type: 'invalidate', step: 'source' })
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('waiting')
    expect(progress(h.state, h.def)).toEqual({ done: 1, total: 2, ratio: 0.5 })
    h.cmd({ type: 'go', step: 'form' })
    h.cmd('next')
    h.ok(h.call('run', 'source'))
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(replay(h)).toEqual(h.state)
  })

  it('preserves the concurrency budget when a static routing step completes during scheduling', () => {
    const h = createHarness(
      dataFlow(
        flow({
          start: ['route', 'a', 'b'],
          steps: {
            route: {
              kind: 'step',
              next: { kind: 'none' },
              hooks: {},
              expose: { input: false, output: false },
            },
            a: runStep(),
            b: runStep(),
          },
          policies: { concurrency: 1 },
        }),
        {},
        ['route', 'a', 'b'],
      ),
    )
    h.start()
    expect(h.state.active).toEqual(['a'])
    expect(h.pending('run').map((effect) => effect.step)).toEqual(['a'])
    h.ok(h.call('run', 'a'), 'a')
    expect(h.state.active).toEqual(['b'])
    expect(h.rec('a').visitedCount).toBe(1)
    h.ok(h.call('run', 'b'), 'b')
    expect(h.rec('b').visitedCount).toBe(1)
  })
})
