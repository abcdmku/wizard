import { describe, expect, it } from 'vitest'
import { eventStep, flow, runStep, view } from '../helpers/fixtures'
import { setup, taskThenFinal, types } from './harness'

describe('interpreter: batch atomicity', () => {
  it('event listeners only ever observe post-batch state', () => {
    const def = taskThenFinal(() => 'out')
    const seen: Array<{ type: string; status: string; attempt: number }> = []
    const { interp } = setup(def, {
      onEvent: (e) => {
        const s = interp.getState()
        seen.push({ type: e.type, status: s.steps.t!.status, attempt: s.steps.t!.attempt })
      },
    })
    interp.send({ type: 'start' })
    // The very first event of the first batch already sees the whole batch applied
    // (task active with attempt 1, set by the last event of that batch).
    expect(seen[0]).toEqual({ type: 'run.started', status: 'active', attempt: 1 })
    expect(seen.map((s) => s.type)).toContain('step.runSucceeded')
    // Events from the second batch (run result) see the task done.
    const done = seen.find((s) => s.type === 'step.runSucceeded')
    expect(done?.status).toBe('done')
  })

  it('reports a message the machine ignores as processed with an empty batch (no commit)', () => {
    const def = flow({ start: 'v', steps: { v: view() } })
    const { interp, commits, processed } = setup(def)
    interp.send({ type: 'start' })
    expect(commits).toHaveLength(1)
    interp.send({ type: 'startReady' }) // nothing is ready to start: the machine decides no event
    expect(commits).toHaveLength(1)
    expect(processed.at(-1)?.msg).toEqual({ type: 'startReady' })
    expect(processed.at(-1)?.batch).toEqual([])
  })

  it('assigns monotonic seq, batch timestamp and path envelopes', () => {
    const def = taskThenFinal(() => 1)
    const { interp, events, sched } = setup(def)
    sched.advance(5)
    interp.send({ type: 'start' })
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    expect(events.every((e) => e.at === 1_005)).toBe(true)
    expect(events.every((e) => e.path.length === 0)).toBe(true)
    expect(interp.getState().seq).toBe(events.length)
  })
})

describe('interpreter: sync-commit guarantee', () => {
  it('a sync hook chain is fully committed before send() returns', () => {
    const def = taskThenFinal(() => ({ ok: true }))
    const { interp } = setup(def)
    interp.send({ type: 'start' })
    const s = interp.getState()
    expect(s.steps.t!.status).toBe('done')
    expect(s.steps.t!.output).toEqual({ ok: true })
    expect(s.status).toBe('done')
  })

  it('an async hook commits only the pre-effect batch synchronously; the result lands in a later drain', async () => {
    let resolveRun: (v: unknown) => void = () => {}
    const def = taskThenFinal(() => new Promise((r) => (resolveRun = r)))
    const { interp, commits } = setup(def)
    interp.send({ type: 'start' })
    expect(interp.getState().steps.t!.status).toBe('active')
    expect(interp.getState().status).toBe('running')
    expect(commits).toHaveLength(1)
    resolveRun('later')
    await Promise.resolve()
    await Promise.resolve()
    expect(interp.getState().steps.t!.status).toBe('done')
    expect(interp.getState().steps.t!.output).toBe('later')
    expect(interp.getState().status).toBe('done')
    // One batch each for the run result of `t`, the entry of `end` and the result of `end`.
    expect(commits).toHaveLength(4)
  })

  it("strict: 'sync' turns a thenable into res.err { syncViolation } in the same drain", () => {
    const def = taskThenFinal(() => Promise.resolve('never'))
    const { interp, events, results } = setup(def, { strict: 'sync' })
    interp.send({ type: 'start' })
    const err = results().find((m) => m.type === 'res.err')
    expect(err).toMatchObject({ type: 'res.err', hook: 'run', syncViolation: true })
    expect(err && err.type === 'res.err' ? err.error.code : undefined).toBe('SYNC_VIOLATION')
    expect(interp.getState().steps.t!.status).toBe('failed')
    expect(interp.getState().steps.t!.error?.kind).toBe('sync-violation')
    expect(types(events)).toContain('run.halted')
  })
})

describe('interpreter: re-entrancy', () => {
  it('send() from a listener is enqueued and processed before the outer call returns', () => {
    const def = flow({
      start: 'v',
      steps: { v: view({ next: 'end' }), end: runStep({ run: () => undefined }) },
    })
    let inputSeenInsideListener: unknown = 'unset'
    let sent = false
    const { interp, events } = setup(def, {
      onCommit: () => {
        if (sent) return
        sent = true
        interp.send({ type: 'setInput', step: 'v', patch: { name: 'x' } })
        // Not processed yet: we are inside the outer drain.
        inputSeenInsideListener = interp.getState().steps.v!.input
      },
    })
    interp.send({ type: 'start' })
    expect(inputSeenInsideListener).toBeUndefined()
    expect(interp.getState().steps.v!.input).toEqual({ name: 'x' })
    const order = types(events)
    expect(order.slice(0, 2)).toEqual(['run.started', 'step.arrived'])
    expect(order.slice(-3)).toEqual(['step.entered', 'transition.committed', 'input.changed'])
  })

  it('a hook calling update() enqueues context.patch, applied before the hook result', () => {
    const def = taskThenFinal(({ update }) => {
      update({ touched: true })
      return 'r'
    })
    const { interp, events } = setup(def, {}, { touched: false })
    interp.send({ type: 'start' })
    const order = types(events)
    expect(order.indexOf('context.changed')).toBeLessThan(order.indexOf('step.runSucceeded'))
    const changed = events.find((e) => e.type === 'context.changed')
    expect(changed).toMatchObject({ type: 'context.changed', patch: { touched: true }, by: 't' })
    expect(interp.getState().context).toEqual({ touched: true })
  })
})

describe('interpreter: causality', () => {
  it('links effect results to the event that planned the effect (causedBy)', () => {
    const def = taskThenFinal(() => 'x')
    const { interp, events } = setup(def)
    interp.send({ type: 'start' })
    const runStarted = events.find((e) => e.type === 'step.runStarted')!
    const succeeded = events.find((e) => e.type === 'step.runSucceeded')!
    expect(succeeded.causedBy).toBe(runStarted.seq)
    // Public commands have no cause.
    expect(events[0]!.causedBy).toBeUndefined()
    // durationMs is stamped on events produced by hook results.
    expect(succeeded.durationMs).toBe(0)
  })

  it('links timer-fired messages to the timer.scheduled event', () => {
    const def = flow({
      start: 'w',
      steps: {
        w: eventStep({ on: { ping: () => undefined }, timeout: { afterMs: 50, next: 'end' } }),
        end: runStep({ run: () => undefined }),
      },
    })
    const { interp, events, sched } = setup(def)
    interp.send({ type: 'start' })
    const scheduled = events.find((e) => e.type === 'timer.scheduled')!
    sched.advance(50)
    const fired = events.find((e) => e.type === 'timer.fired')!
    expect(fired.causedBy).toBe(scheduled.seq)
    expect(interp.getState().status).toBe('done')
  })
})

describe('interpreter: log ring', () => {
  it('keeps at most logSize events, newest last', () => {
    const def = taskThenFinal(() => 'x')
    const { interp, events } = setup(def, { logSize: 5 })
    interp.send({ type: 'start' })
    expect(events.length).toBeGreaterThan(5)
    const log = interp.log()
    expect(log).toHaveLength(5)
    expect(log.map((e) => e.seq)).toEqual(events.slice(-5).map((e) => e.seq))
    // log() returns a copy
    expect(interp.log()).not.toBe(log)
  })
})
