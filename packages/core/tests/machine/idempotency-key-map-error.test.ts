/**
 * Steps with an idempotency key (crash-resume re-run) and `mapError` → `StepError.data`, plus a
 * `replay(log) == state` fixture exercising their events. Pure machine tests.
 */
import { describe, expect, it } from 'vitest'
import {
  createHarness,
  flow,
  needAll,
  needOptional,
  of,
  replay,
  routingStep,
  runStep,
  view,
} from '../helpers/fixtures'

const key = () => 'k'
const map = () => ({})

describe('steps with an idempotency key', () => {
  it('resume: a running step with an idempotency key is re-run with the same attempt/key (step.runStarted{resumed:true}); one without a key fails interrupted', () => {
    const h = createHarness(
      flow({
        start: ['a', 'b'],
        steps: {
          a: runStep({ idempotent: true, retry: { retries: 2, backoff: 10 }, next: 'end' }),
          b: runStep({ next: 'end' }),
          end: routingStep({ needs: needAll('a', 'b') }),
        },
      }),
    )
    h.start()
    // a is on its second attempt when the process dies
    h.err(h.call('run', 'a'), 'flaky')
    h.clock.advance(10)
    h.fire('retry:a')
    expect(h.rec('a')).toMatchObject({ attempt: 2, idempotencyKey: 'inst-1:a:1' })
    const r = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(r.types).toEqual(['run.resumed', 'step.runStarted', 'step.failed', 'run.halted'])
    expect(of(r, 'run.resumed')[0]?.interrupted).toEqual(['a', 'b'])
    expect(of(r, 'step.runStarted')[0]).toEqual(
      expect.objectContaining({
        step: 'a',
        attempt: 2,
        runId: 1,
        idempotencyKey: 'inst-1:a:1',
        resumed: true,
      }),
    )
    expect(of(r, 'step.failed')[0]).toMatchObject({ step: 'b', kind: 'interrupted' })
    // the run is re-issued exactly once (no duplicate from planResume)
    const runs = r.effects.filter((e) => e.kind === 'call' && e.hook === 'run')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ step: 'a', token: { step: 'a', runId: 1, attempt: 2 } })
    expect(h.rec('a').status).toBe('active')
    // halted by b, but a's re-run still settles
    h.ok(h.call('run', 'a'), 'ok')
    expect(h.rec('a').status).toBe('done')
    expect(replay(h)).toEqual(h.state)
  })

  it('a custom idempotencyKey hook is called before the run (step.idempotencyKeyRequested → call → step.runStarted with its value); retries and resume keep the key', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: runStep({
            idempotent: true,
            idempotencyKey: key,
            retry: { retries: 1, backoff: 5 },
            next: 'end',
          }),
          end: routingStep(),
        },
      }),
    )
    const r = h.start()
    expect(r.types).toEqual([
      'run.started',
      'step.arrived',
      'step.entered',
      'step.idempotencyKeyRequested',
    ])
    expect(h.pending('run')).toHaveLength(0)
    const k = h.call('idempotencyKey', 't')
    expect(k.token).toEqual({ step: 't', runId: 1 })
    expect(k.extra).toEqual({ attempt: 1 })
    // a resume while the key is being computed re-issues the key call, not the run
    const res = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(res.types).toEqual(['run.resumed'])
    expect(res.effects.filter((e) => e.kind === 'call').map((e) => e.hook)).toEqual([
      'idempotencyKey',
    ])
    const started = h.ok(h.call('idempotencyKey', 't'), 'order-42:reserve')
    expect(started.types).toEqual(['step.runStarted'])
    expect(of(started, 'step.runStarted')[0]).toMatchObject({
      attempt: 1,
      idempotencyKey: 'order-42:reserve',
    })
    expect(h.rec('t').idempotencyKey).toBe('order-42:reserve')
    // retry timer keeps the same key
    h.err(h.call('run', 't'), 'x')
    h.clock.advance(5)
    expect(of(h.fire('retry:t'), 'step.runStarted')[0]?.idempotencyKey).toBe('order-42:reserve')
    // crash → resumed run keeps the key
    const again = h.step({ type: 'resume', fromSeq: h.state.seq })
    expect(of(again, 'step.runStarted')[0]).toMatchObject({
      idempotencyKey: 'order-42:reserve',
      resumed: true,
    })
    // a stale key result (run already started) is ignored
    expect(h.ok(k, 'late').types).toEqual(['result.ignored'])
    expect(replay(h)).toEqual(h.state)
  })

  it('a non-string key falls back to the default; a throwing key hook fails the step', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: runStep({ idempotencyKey: key, next: 'end' }), end: routingStep() },
      }),
    )
    h.start()
    expect(of(h.ok(h.call('idempotencyKey'), 42), 'step.runStarted')[0]?.idempotencyKey).toBe(
      'inst-1:t:1',
    )
    const g = createHarness(h.def)
    g.start()
    expect(g.err(g.call('idempotencyKey'), 'no key').types).toEqual(['step.failed', 'run.halted'])
  })
})

describe('mapError', () => {
  it('each attempt failure maps first (step.mapErrorStarted → call mapError{error}) then step.runFailed{data}; the final failure carries data on step.failed and StepError.data', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: {
          t: runStep({ mapError: map, retry: { retries: 1, backoff: 100 }, next: 'end' }),
          end: routingStep(),
        },
      }),
    )
    h.start()
    const first = h.err(h.call('run'), { name: 'HttpError', message: '503', code: 'E503' })
    expect(first.types).toEqual(['step.mapErrorStarted'])
    expect(of(first, 'step.mapErrorStarted')[0]).toMatchObject({
      step: 't',
      attempt: 1,
      error: { name: 'HttpError', message: '503', code: 'E503' },
    })
    const m = h.call('mapError', 't')
    expect(m.token).toEqual({ step: 't', runId: 1, attempt: 1 })
    expect(m.extra).toMatchObject({ error: { code: 'E503' }, attempt: 1 })
    // the task still looks running until the mapper answers; a resume treats it as interrupted (documented)
    expect(h.rec('t').status).toBe('active')
    const mapped = h.ok(m, { retryable: true, status: 503 })
    expect(mapped.types).toEqual(['step.runFailed', 'step.retryScheduled'])
    expect(of(mapped, 'step.runFailed')[0]).toMatchObject({
      willRetry: true,
      data: { retryable: true, status: 503 },
    })
    expect(h.rec('t').error).toMatchObject({ kind: 'run', data: { retryable: true, status: 503 } })
    h.clock.advance(100)
    h.fire('retry:t')
    h.err(h.call('run'), 'gone', { timedOut: true })
    const m2 = h.call('mapError', 't')
    expect(m2.extra).toMatchObject({ timedOut: true, attempt: 2 })
    const failed = h.ok(m2, { retryable: false })
    expect(failed.types).toEqual(['step.runFailed', 'step.failed', 'run.halted'])
    expect(of(failed, 'step.failed')[0]).toMatchObject({
      kind: 'timeout',
      data: { retryable: false },
    })
    expect(h.rec('t').error).toMatchObject({
      kind: 'timeout',
      attempt: 2,
      data: { retryable: false },
    })
    expect(replay(h)).toEqual(h.state)
  })

  it('a throwing mapError yields no data (the original failure is recorded); a cancel while mapping ignores the map result', () => {
    const h = createHarness(
      flow({
        start: 't',
        steps: { t: runStep({ mapError: map, next: 'end' }), end: routingStep() },
      }),
    )
    h.start()
    h.err(h.call('run'), 'boom')
    const r = h.err(h.call('mapError'), 'mapper bug')
    expect(r.types).toEqual(['step.runFailed', 'step.failed', 'run.halted'])
    expect(of(r, 'step.failed')[0]).toMatchObject({ error: { message: 'boom' } })
    expect(of(r, 'step.failed')[0]).not.toHaveProperty('data')
    expect(h.rec('t').error).not.toHaveProperty('data')

    const g = createHarness(h.def)
    g.start()
    g.err(g.call('run'), 'boom')
    const m = g.call('mapError')
    g.cmd({ type: 'cancel', reason: 'stop' })
    expect(g.ok(m, { x: 1 }).types).toEqual(['result.ignored'])
    expect(of(g.log, 'result.ignored')[0]?.reason).toBe('cancelled')
  })
})

describe('replay(log) == state — every event kind', () => {
  it('a flow using when/skip/invalidate/on-any-kind/flow-level on/mapError/idempotencyKey replays exactly', () => {
    const on = () => undefined
    const h = createHarness(
      flow({
        name: 'replayed',
        start: 'a',
        correlate: { note: (p) => (p as { id?: string }).id },
        on: { note: on, stop: on },
        steps: {
          a: view({ on: { hint: on }, next: ['opt', 'work'] }),
          opt: view({ when: () => false, next: 'join' }),
          work: runStep({
            idempotent: true,
            idempotencyKey: () => 'w',
            mapError: () => ({ mapped: true }),
            retry: { retries: 1, backoff: 10 },
            on: { progress: on },
            next: 'join',
          }),
          join: runStep({ needs: { ...needOptional('opt'), ...needAll('work') }, next: 'b' }),
          b: view({ needs: needAll('join'), next: 'end' }),
          end: routingStep(),
        },
      }),
      { correlationId: 'me' },
    )
    h.start()
    h.cmd({ type: 'send', event: 'hint', payload: 1 })
    h.ok(h.call('on', 'a'), undefined)
    h.cmd({ type: 'send', event: 'note', payload: { id: 'other' } }) // dropped: correlation
    h.cmd({ type: 'send', event: 'note', payload: { id: 'me' } }) // flow-level only
    h.ok(h.call('wizardOn'), undefined)
    h.cmd('next') // a → opt(when) + work(key)
    h.ok(h.call('when', 'opt'), false)
    h.ok(h.call('idempotencyKey', 'work'), 'w')
    h.cmd({ type: 'send', event: 'progress', payload: 50 })
    h.ok(h.call('on', 'work'), { next: 'nope' }) // ignored: kind
    h.err(h.call('run', 'work'), 'first')
    h.ok(h.call('mapError', 'work'), { mapped: true })
    h.clock.advance(10)
    h.fire('retry:work')
    h.step({ type: 'resume', fromSeq: h.state.seq }) // idempotent → re-run
    h.ok(h.call('run', 'work'), 'w-out')
    h.ok(h.call('run', 'join'), 'j')
    expect(h.state.current).toBe('b')
    h.cmd({ type: 'invalidate', step: 'work' }) // cascades: join, b (current → cancelled)
    expect(h.state.current).toBeNull()
    h.cmd({ type: 'go', step: 'a' })
    h.cmd({ type: 'skip', step: 'a' })
    expect(replay(h)).toEqual(h.state)
    expect(h.log.map((e) => e.seq)).toEqual(h.log.map((_, i) => i + 1))
    // sanity: the new events all appear in the log
    const seen = new Set(h.log.map((e) => e.type))
    for (const t of [
      'event.dropped',
      'event.wizardDelivered',
      'event.handlerResultIgnored',
      'step.whenStarted',
      'step.whenEvaluated',
      'step.skipped',
      'step.idempotencyKeyRequested',
      'step.mapErrorStarted',
      'step.invalidated',
    ])
      expect(seen.has(t as never), t).toBe(true)
  })
})
