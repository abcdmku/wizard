import { describe, expect, it } from 'vitest'
import { createHarness, eventStep, flow, of, runStep, view } from '../helpers/fixtures'

describe('resume committed automatic navigation', () => {
  it('resumes next after a wait handler completed without redelivering the event', () => {
    const h = createHarness(
      flow({
        start: 'lobby',
        steps: {
          lobby: eventStep({
            on: { accepted: () => ({ done: { approved: true } }) },
            dynamicNext: () => 'ready',
            targets: ['ready'],
          }),
          ready: eventStep({ on: { launch: () => ({ done: true }) } }),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'accepted', payload: {} })
    h.ok(h.call('on', 'lobby'), { done: { approved: true } })
    const oldTx = h.state.nav.txId
    expect(h.rec('lobby').status).toBe('done')
    expect(h.state.nav.phase).toBe('resolvingTarget')

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(of(resumed, 'transition.rejected')[0]).toMatchObject({ txId: oldTx, reason: 'resumed' })
    expect(
      resumed.effects.flatMap((effect) =>
        effect.kind === 'call' ? [[effect.step, effect.hook]] : [],
      ),
    ).toEqual([['lobby', 'next']])
    expect(h.state.nav.txId).not.toBe(oldTx)
    expect(h.rec('lobby').output).toEqual({ approved: true })

    h.ok(h.call('next', 'lobby'), 'ready')

    expect(h.state.active).toEqual(['ready'])
    expect(h.state.status).toBe('waiting')
    expect(
      h.log.filter((event) => event.type === 'step.done' && event.step === 'lobby'),
    ).toHaveLength(1)
    expect(
      h.log.filter((event) => event.type === 'event.delivered' && event.to === 'lobby'),
    ).toHaveLength(1)
  })

  it('reuses resolved target arrays without rerunning a completed task or next hook', () => {
    const h = createHarness(
      flow({
        start: 'task',
        steps: {
          task: runStep({ dynamicNext: () => ['left', 'right'], targets: ['left', 'right'] }),
          left: view({ canEnter: () => true }),
          right: view({ canEnter: () => true }),
        },
      }),
    )
    h.start()
    h.ok(h.call('run'), { result: 7 })
    h.ok(h.call('next'), ['left', 'right'])
    expect(h.state.nav.phase).toBe('canEnter')

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(
      resumed.effects.flatMap((effect) =>
        effect.kind === 'call' ? [[effect.step, effect.hook]] : [],
      ),
    ).toEqual([
      ['left', 'canEnter'],
      ['right', 'canEnter'],
    ])
    expect(h.state.nav.targets).toEqual(['left', 'right'])
    expect(h.rec('task').output).toEqual({ result: 7 })
    h.ok(h.call('canEnter', 'left'), true)
    h.ok(h.call('canEnter', 'right'), true)
    expect(h.state.current).toBe('left')
    expect(h.rec('right').pendingActivation).toBe(true)
    expect(
      h.log.filter((event) => event.type === 'step.done' && event.step === 'task'),
    ).toHaveLength(1)
  })

  it('preserves a resolved empty route while restarting an unfinished exit hook', () => {
    const h = createHarness(
      flow({
        start: 'task',
        steps: {
          task: runStep({ dynamicNext: () => null, targets: [], exit: () => undefined }),
        },
      }),
    )
    h.start()
    h.ok(h.call('run'), 7)
    h.ok(h.call('next'), null)
    expect(h.state.nav.phase).toBe('exiting')
    expect(h.state.nav.targets).toEqual([])

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(
      resumed.effects.flatMap((effect) => (effect.kind === 'call' ? [effect.hook] : [])),
    ).toEqual(['exit'])
    expect(h.state.nav.targets).toEqual([])
    h.ok(h.call('exit'))
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.rec('task').output).toBe(7)
  })

  it('rejects saved user navigation without completing the view or replaying its next hook', () => {
    const h = createHarness(
      flow({
        start: 'a',
        steps: { a: view({ dynamicNext: () => 'b', targets: ['b'] }), b: view() },
      }),
    )
    h.start()
    h.cmd('next')
    expect(h.state.nav.cause).toBe('next')

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(of(resumed, 'transition.rejected')[0]?.reason).toBe('resumed')
    expect(resumed.effects.filter((effect) => effect.kind === 'call')).toEqual([])
    expect(h.state.nav.phase).toBe('idle')
    expect(h.state.current).toBe('a')
    expect(h.rec('a').status).toBe('active')
    expect(h.rec('b').status).toBe('idle')
  })

  it('keeps another completed source deferred and advances each source exactly once', () => {
    const h = createHarness(
      flow({
        start: ['first', 'second'],
        steps: {
          first: runStep({ dynamicNext: () => 'left', targets: ['left'] }),
          second: runStep({ next: 'right' }),
          left: view(),
          right: view(),
        },
      }),
    )
    h.start()
    h.ok(h.call('run', 'first'), 1)
    h.ok(h.call('run', 'second'), 2)
    expect(h.state.nav.deferred).toEqual([{ step: 'second' }])

    h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(h.state.nav.deferred).toEqual([{ step: 'second' }])
    h.ok(h.call('next', 'first'), 'left')
    expect(h.state.current).toBe('left')
    expect(h.rec('right').pendingActivation).toBe(true)
    expect(h.state.nav.deferred).toBeUndefined()
    expect(
      h.log.filter((event) => event.type === 'step.arrived').map((event) => event.step),
    ).toEqual(['first', 'second', 'left', 'right'])
  })

  it('queues the saved continuation behind an overdue sleep navigation without losing either', () => {
    const h = createHarness(
      flow({
        start: ['lobby', 'alarm'],
        steps: {
          lobby: eventStep({
            on: { accepted: () => ({ done: true }) },
            dynamicNext: () => 'ready',
            targets: ['ready'],
          }),
          alarm: runStep({ sleep: 100, dynamicNext: () => 'awake', targets: ['awake'] }),
          ready: eventStep({ on: { launch: () => ({ done: true }) } }),
          awake: eventStep({ on: { dismiss: () => ({ done: true }) } }),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'accepted', payload: {} })
    h.ok(h.call('on', 'lobby'), { done: true })
    h.clock.advance(101)

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(h.state.nav.from).toBe('alarm')
    expect(h.state.nav.deferred).toEqual([{ step: 'lobby' }])
    expect(
      resumed.effects.flatMap((effect) =>
        effect.kind === 'call' ? [[effect.step, effect.hook]] : [],
      ),
    ).toEqual([['alarm', 'next']])
    h.ok(h.call('next', 'alarm'), 'awake')
    expect(h.state.nav.from).toBe('lobby')
    expect(h.state.nav.deferred).toBeUndefined()
    h.ok(h.call('next', 'lobby'), 'ready')

    expect(h.state.active).toEqual(['awake', 'ready'])
    expect(h.state.nav.phase).toBe('idle')
    expect(h.log.filter((event) => event.type === 'step.done').map((event) => event.step)).toEqual([
      'lobby',
      'alarm',
    ])
    expect(
      h.log.filter((event) => event.type === 'step.arrived').map((event) => event.step),
    ).toEqual(['lobby', 'alarm', 'awake', 'ready'])
  })

  it('keeps recovered navigation parked while another failed step halts the run', () => {
    const h = createHarness(
      flow({
        start: ['lobby', 'background'],
        steps: {
          lobby: eventStep({
            on: { accepted: () => ({ done: true }) },
            dynamicNext: () => 'ready',
            targets: ['ready'],
          }),
          background: runStep({ next: 'finish' }),
          ready: eventStep({ on: { launch: () => ({ done: true }) } }),
          finish: view(),
        },
      }),
    )
    h.start()
    h.cmd({ type: 'send', event: 'accepted', payload: {} })
    h.ok(h.call('on', 'lobby'), { done: true })
    h.err(h.call('run', 'background'), 'blocked')

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })

    expect(resumed.effects.filter((effect) => effect.kind === 'call')).toEqual([])
    expect(h.state.status).toBe('halted')
    expect(h.state.nav.phase).toBe('idle')
    expect(h.state.nav.deferred).toEqual([{ step: 'lobby' }])

    h.cmd({ type: 'retry', step: 'background' })
    h.ok(h.call('run', 'background'), 7)
    h.ok(h.call('next', 'lobby'), 'ready')

    expect(h.state.status).toBe('waiting')
    expect(h.state.nav.deferred).toBeUndefined()
    expect(h.rec('ready').status).toBe('active')
  })
})
