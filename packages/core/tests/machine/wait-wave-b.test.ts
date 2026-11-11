import { describe, expect, it } from 'vitest'
import type { CompiledFlow, CompiledStep } from '../../src/authoring/compiled'
import { createHarness, of, replay, trusted } from '../helpers/fixtures'

type Step = Omit<CompiledStep, 'id'>

function fixture(
  steps: Readonly<Record<string, Step>>,
  start: readonly string[],
  sinks: readonly string[],
): CompiledFlow {
  return {
    name: 'wait-wave-b',
    version: 1,
    context: trusted(),
    events: { paid: trusted() },
    steps: Object.fromEntries(Object.entries(steps).map(([id, step]) => [id, { id, ...step }])),
    order: Object.keys(steps),
    start,
    feeds: {},
    sinks,
    policies: {
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: 60_000 },
    },
    identity: {},
  }
}

const wait: Step = {
  kind: 'step',
  next: { kind: 'none' },
  hooks: { waitFor: { paid: () => undefined } },
  expose: { input: false, output: true },
}

const view: Step = {
  kind: 'view',
  next: { kind: 'none' },
  hooks: {},
  expose: { input: true, output: false },
}

describe('Wave B waits', () => {
  it('uses the event payload as output when the handler returns nothing', () => {
    const h = createHarness(fixture({ waiting: wait }, ['waiting'], ['waiting']))
    h.start()
    const received = h.cmd({ type: 'send', event: 'paid', payload: { receipt: 'r-1' } })
    expect(received.types).toEqual(['event.received', 'event.delivered'])
    expect(h.call('on').extra).toMatchObject({ event: 'paid', payload: { receipt: 'r-1' } })

    h.ok(h.call('on'))
    expect(h.rec('waiting').output).toEqual({ receipt: 'r-1' })
    expect(h.state.active).toEqual([])
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.state.output).toEqual({ receipt: 'r-1' })
  })

  it('uses done as output and follows the next declared on the step', () => {
    const h = createHarness(
      fixture(
        { waiting: { ...wait, next: { kind: 'static', targets: ['review'] } }, review: view },
        ['waiting'],
        ['review'],
      ),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: { receipt: 'raw' } })
    h.ok(h.call('on'), { done: 'accepted' })
    expect(h.rec('waiting').output).toBe('accepted')
    expect(h.rec('review').status).toBe('active')
    expect(h.state.active).toEqual(['review'])
    expect(replay(h)).toEqual(h.state)
  })

  it.each([
    { done: 'accepted', next: 'review' },
    { done: 'accepted', next: null },
    { done: 'accepted', next: undefined },
    { keep: true, next: 'review' },
    { fail: 'declined', next: 'review' },
  ])('fails trusted JavaScript results containing next: %j', (result) => {
    const h = createHarness(
      fixture(
        { waiting: { ...wait, next: { kind: 'static', targets: ['review'] } }, review: view },
        ['waiting'],
        ['review'],
      ),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: null })
    h.ok(h.call('on'), result)
    expect(h.rec('waiting').error).toEqual({
      name: 'WizardError',
      code: 'INVALID_WAIT_RESULT',
      message: "waitFor handler of 'waiting' cannot return 'next'; configure next on the step",
      kind: 'hook',
      at: 1_000,
    })
    expect(h.state.status).toBe('halted')
    expect(h.rec('review').status).toBe('idle')
  })

  it('keep drains the next buffered event without resetting the timeout', () => {
    const h = createHarness(
      fixture(
        {
          input: { ...view, next: { kind: 'static', targets: ['waiting'] } },
          waiting: { ...wait, waitTimeout: { afterMs: 500, next: 'expired' } },
          expired: view,
        },
        ['input'],
        ['waiting', 'expired'],
      ),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'first' })
    h.cmd({ type: 'send', event: 'paid', payload: 'second' })
    h.cmd('next')
    expect(h.call('on').extra?.payload).toBe('first')
    expect(h.rec('waiting').deadline).toBe(1_500)
    h.clock.advance(100)

    h.ok(h.call('on'), { keep: true })
    expect(h.call('on').extra?.payload).toBe('second')
    expect(h.rec('waiting').deadline).toBe(1_500)
    expect(h.state.inbox).toEqual([])
    h.ok(h.call('on'), { done: 'accepted' })
    expect(h.rec('waiting').output).toBe('accepted')
    expect(h.state.timers).toEqual({})
  })

  it('a timeout follows its alternate edge with undefined output', () => {
    const h = createHarness(
      fixture(
        { waiting: { ...wait, waitTimeout: { afterMs: 500, next: 'expired' } }, expired: view },
        ['waiting'],
        ['waiting', 'expired'],
      ),
    )
    h.start()
    h.clock.advance(500)
    const expired = h.fire('wait:waiting')
    expect(of(expired, 'step.done')[0]).toMatchObject({ step: 'waiting', next: 'expired' })
    expect(h.rec('waiting').output).toBeUndefined()
    expect(h.rec('expired').status).toBe('active')
    expect(h.state.timers).toEqual({})
  })

  it('runs passive on handlers alongside waitFor without completing or failing the wait', () => {
    const h = createHarness(
      fixture(
        { waiting: { ...wait, hooks: { ...wait.hooks, on: { audit: () => undefined } } } },
        ['waiting'],
        ['waiting'],
      ),
    )
    h.start()
    h.cmd({ type: 'send', event: 'audit', payload: 'log' })
    h.ok(h.call('on'))
    expect(h.rec('waiting').status).toBe('active')
    h.cmd({ type: 'send', event: 'audit', payload: 'retry-log' })
    const failure = h.err(h.call('on'), 'audit unavailable')
    expect(of(failure, 'event.handlerFailed')[0]).toMatchObject({
      event: 'audit',
      step: 'waiting',
      error: { name: 'Error', message: 'audit unavailable' },
    })
    expect(h.rec('waiting').status).toBe('active')
    expect(h.state.status).toBe('waiting')
    h.cmd({ type: 'send', event: 'paid', payload: 'receipt' })
    h.ok(h.call('on'))
    expect(h.rec('waiting').status).toBe('done')
    expect(h.rec('waiting').output).toBe('receipt')
  })

  it('commits buffered synchronous updates and wait completion in one batch', () => {
    const h = createHarness(fixture({ waiting: wait }, ['waiting'], ['waiting']), {
      context: { phase: 'waiting', count: 0 },
    })
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'receipt' })
    const call = h.call('on')
    const result = h.step({
      type: 'res.ok',
      effectId: call.effectId,
      hook: call.hook,
      token: call.token,
      ...(call.extra !== undefined ? { extra: call.extra } : {}),
      durationMs: 0,
      updates: [
        { phase: 'complete' },
        (current) => {
          expect(current).toEqual({ phase: 'complete', count: 0 })
          return { count: 1 }
        },
      ],
      value: { done: 'accepted' },
    })
    expect(result.types).toEqual(['context.changed', 'context.changed', 'step.done'])
    expect(result.effects).toEqual([{ kind: 'persist', reason: 'change' }])
    expect(h.state.context).toEqual({ phase: 'complete', count: 1 })
    expect(h.rec('waiting').status).toBe('done')
    expect(replay(h, { context: { phase: 'waiting', count: 0 } })).toEqual(h.state)
  })

  it('stops buffered updates and completion when an updater fails', () => {
    const h = createHarness(fixture({ waiting: wait }, ['waiting'], ['waiting']), {
      context: { phase: 'waiting' },
    })
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'receipt' })
    const call = h.call('on')
    const result = h.step({
      type: 'res.ok',
      effectId: call.effectId,
      hook: call.hook,
      token: call.token,
      ...(call.extra !== undefined ? { extra: call.extra } : {}),
      durationMs: 0,
      updates: [
        { phase: 'updating' },
        () => {
          throw new Error('invalid update')
        },
        { phase: 'complete' },
      ],
      value: { done: 'accepted' },
    })
    expect(result.types).toEqual(['context.changed', 'step.failed', 'flow.halted'])
    expect(h.state.context).toEqual({ phase: 'updating' })
    expect(h.state.status).toBe('halted')
    expect(h.rec('waiting').output).toBeUndefined()
  })

  it('drops buffered updates from a delivery that an earlier listener halted', () => {
    const h = createHarness(fixture({ first: wait, second: wait }, ['first', 'second'], ['second']))
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'receipt' })
    const first = h.call('on', 'first')
    const second = h.call('on', 'second')
    h.ok(first, { fail: 'declined' })
    const result = h.step({
      type: 'res.ok',
      effectId: second.effectId,
      hook: second.hook,
      token: second.token,
      ...(second.extra !== undefined ? { extra: second.extra } : {}),
      durationMs: 0,
      updates: [{ leaked: true }],
      value: { done: 'accepted' },
    })
    expect(result.types).toEqual(['result.ignored'])
    expect(h.state.context).toEqual({})
    expect(h.rec('second').status).toBe('active')
  })
})

describe('Wave B default output', () => {
  it('keeps the last completed sink output when a routing step finishes later', () => {
    const h = createHarness(
      fixture(
        {
          waiting: wait,
          route: {
            ...wait,
            hooks: { next: () => null },
            next: { kind: 'dynamic', targets: ['excluded'] },
          },
          excluded: view,
        },
        ['waiting', 'route'],
        ['waiting', 'excluded'],
      ),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'receipt' })
    h.ok(h.call('on'), { done: 'accepted' })
    h.ok(h.call('next'), null)
    expect(h.rec('route').output).toBeUndefined()
    expect(h.rec('excluded').status).toBe('skipped')
    h.step({ type: 'settle' })
    expect(h.state.output).toBe('accepted')
  })

  it('has undefined output when no sink completed', () => {
    const h = createHarness(
      fixture(
        {
          waiting: {
            ...wait,
            next: { kind: 'dynamic', targets: ['waiting'] },
            hooks: { ...wait.hooks, next: () => null },
          },
        },
        ['waiting'],
        [],
      ),
    )
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'inner value' })
    h.ok(h.call('on'))
    h.ok(h.call('next'), null)
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.state.output).toBeUndefined()
  })

  it('the explicit selector takes precedence over sink outputs', () => {
    const h = createHarness({
      ...fixture({ waiting: wait }, ['waiting'], ['waiting']),
      output: () => 'selected',
    })
    h.start()
    h.cmd({ type: 'send', event: 'paid', payload: 'receipt' })
    h.ok(h.call('on'), { done: 'accepted' })
    h.step({ type: 'settle' })
    expect(h.state.output).toBe('selected')
  })
})
