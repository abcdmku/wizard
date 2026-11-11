import { describe, expect, it } from 'vitest'
import type { CompiledWizard } from '../../src/authoring/compiled'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { DomainEvent } from '../../src/machine/events'
import { initialState, machine } from '../../src/machine/index'
import type { WizardState } from '../../src/machine/state'
import { createWizardRuntime, type WizardRuntimeOptions } from '../../src/wizard/runtime'
import { findRejected } from '../../src/wizard/runtime/results'
import { eventStep, flow, runStep, stringsBoundary, view } from '../helpers/fixtures'
import { types } from '../interpreter/harness'

function make(def: CompiledWizard, opts: Partial<WizardRuntimeOptions> = {}) {
  const sched = createTestScheduler({ now: 1_000 })
  const run = createWizardRuntime(def, {
    context: { tenant: 't1' },
    machine,
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...opts,
  })
  const events: DomainEvent[] = []
  const states: WizardState[] = []
  run.observe((e) => events.push(e))
  run.subscribe((s) => states.push(s))
  return { run, sched, events, states }
}

const twoViews = (extra: Record<string, any> = {}) =>
  flow({
    start: 'a',
    steps: {
      a: { ...view({ next: 'b' }), ...extra.a },
      b: { ...view({ next: 'end' }), ...extra.b },
      end: runStep(),
    },
  })

describe('run runtime: identity and options', () => {
  it('exposes id, path and epoch; a TestScheduler doubles as the clock', async () => {
    const { run, sched, events } = make(twoViews())
    expect(run.id).toBe('wiz-1')
    expect(run.path).toEqual([])
    expect(run.epoch).toBe(0)
    sched.advance(25)
    await run.start()
    expect(events[0]?.at).toBe(1_025)
  })

  it('start() resolves { ok, seq } and a second start is a rejected command', async () => {
    const { run, states } = make(twoViews())
    const r1 = await run.start()
    expect(r1).toEqual({ ok: true, seq: run.getState().seq })
    expect(r1).toMatchObject({ seq: states[0]!.seq })
    expect(states).toHaveLength(1)
    const r2 = await run.start()
    expect(r2).toEqual({
      ok: false,
      code: 'INVALID_COMMAND',
      message: 'start: the run has already started',
    })
  })
})

describe('run runtime: dispatch result mapping', () => {
  it('maps command.rejected to { ok: false, code, message, step }', async () => {
    const { run } = make(twoViews())
    await run.start()
    const r = await run.retry('a')
    expect(r).toEqual({
      ok: false,
      code: 'NOT_RUNNABLE',
      message: "'a' has no run function; only runnable steps can be run or retried",
      step: 'a',
    })
  })

  it('degrades an unknown rejection code to INVALID_COMMAND', () => {
    const command = { type: 'startReady' } as const
    const rejected = findRejected([
      {
        type: 'command.rejected',
        command,
        reason: 'nope',
        code: 'WHATEVER',
        seq: 1,
        at: 0,
        path: [],
      },
    ])
    expect(rejected).toEqual({ ok: false, code: 'INVALID_COMMAND', message: 'nope' })
  })

  it('a message the machine ignores resolves { ok: true } with the current seq', async () => {
    const { run } = make(twoViews())
    await run.start()
    const seq = run.getState().seq
    expect(await run.startReady()).toEqual({ ok: true, seq })
    expect(run.getState().seq).toBe(seq)
  })

  it('validates wire shapes: invalid input never throws', async () => {
    const { run } = make(twoViews())
    const r = await run.dispatch({ type: 'go' } as any)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect((r as any).issues[0]).toMatchObject({ path: ['step'] })
    const r2 = await run.dispatch('nonsense' as any)
    expect(r2).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
  })

  it('setInput/resetInput/cancel are plain command results', async () => {
    const { run } = make(twoViews())
    await run.start()
    const started = run.getState().seq
    expect(await run.setInput('a', { name: 'x' })).toEqual({ ok: true, seq: started + 1 })
    expect(run.getState().steps.a!.input).toEqual({ name: 'x' })
    expect(await run.setInput('end', {})).toMatchObject({ ok: false, code: 'NOT_A_VIEW' })
    expect(await run.cancel('bye')).toEqual({ ok: true, seq: run.getState().seq })
    expect(run.getState().status).toBe('cancelled')
    expect(await run.next()).toMatchObject({
      ok: false,
      reason: 'run-terminal',
      code: 'RUN_TERMINAL',
    })
  })
})

describe('run runtime: navigation promises', () => {
  it('a fully synchronous next() commits before the promise is awaited and resolves via the batch', async () => {
    const { run, events } = make(twoViews())
    await run.start()
    const p = run.next()
    // Sync-commit guarantee at the façade level.
    expect(run.getState().current).toBe('b')
    const r = await p
    expect(r).toEqual({ ok: true, from: 'a', to: 'b', seq: run.getState().seq })
    expect(types(events)).toContain('transition.committed')
  })

  it('an async canExit settles the nav promise later; false or a throw → guard rejection', async () => {
    let answer: unknown = true
    const def = twoViews({ a: { hooks: { canExit: () => Promise.resolve(answer) } } })
    const { run, events } = make(def)
    await run.start()

    const p = run.next()
    expect(run.getState().nav.phase).toBe('canExit')
    expect(run.getState().current).toBe('a')
    expect(await p).toMatchObject({ ok: true, from: 'a', to: 'b' })

    // back to a with a scripted go
    await run.go('a')
    answer = false
    expect(await run.next()).toMatchObject({
      ok: false,
      reason: 'guard-canExit',
      code: 'GUARD_BLOCKED',
      step: 'a',
    })
    // A guard that throws vetoes like `false`; the event keeps the thrown message as the reason.
    answer = Promise.reject(new Error('guard exploded'))
    expect(await run.next()).toMatchObject({
      ok: false,
      reason: 'guard-canExit',
      code: 'GUARD_BLOCKED',
      step: 'a',
    })
    expect(events.filter((e) => e.type === 'step.guardEvaluated').at(-1)).toMatchObject({
      hook: 'canExit',
      ok: false,
      reason: 'guard exploded',
    })
  })

  it('a hook that throws while leaving a view fails the navigation', async () => {
    const def = twoViews({
      a: {
        hooks: {
          exit: () => {
            throw new Error('exit exploded')
          },
        },
      },
    })
    const { run } = make(def)
    await run.start()
    expect(await run.next()).toMatchObject({
      ok: false,
      reason: 'failed',
      code: 'HOOK_FAILED',
      message: 'exit exploded',
      step: 'a',
    })
    expect(run.getState().current).toBe('a')
  })

  it('not-started, nav-busy and not-a-view rejections carry reason + code', async () => {
    const def = twoViews({ a: { hooks: { canExit: () => new Promise(() => {}) } } })
    const { run } = make(def)
    expect(await run.next()).toMatchObject({
      ok: false,
      reason: 'run-not-started',
      code: 'RUN_NOT_STARTED',
    })
    await run.start()
    void run.next() // hangs in canExit
    expect(await run.next()).toMatchObject({ ok: false, reason: 'nav-busy', code: 'NAV_BUSY' })

    const idle = make(twoViews()).run
    await idle.start()
    // An id that names no step is not a view to go to.
    expect(await idle.go('nope')).toMatchObject({
      ok: false,
      reason: 'not-a-view',
      code: 'NOT_A_VIEW',
    })
    expect(await idle.go('end')).toMatchObject({
      ok: false,
      reason: 'not-a-view',
      code: 'NOT_A_VIEW',
      step: 'end',
    })
  })

  it('dispatch() of a nav command maps the NavResult to a CommandResult', async () => {
    const { run } = make(twoViews())
    await run.start()
    const moved = await run.dispatch({ type: 'next' })
    expect(moved).toEqual({ ok: true, seq: run.getState().seq })
    expect(run.getState().current).toBe('b')
    expect(await run.dispatch({ type: 'go', step: 'end' })).toMatchObject({
      ok: false,
      code: 'NOT_A_VIEW',
      step: 'end',
    })
  })
})

describe('run runtime: external events', () => {
  const waitFlow = (buffer = true) =>
    flow({
      events: { ping: stringsBoundary('id'), other: stringsBoundary('id') },
      policies: { unmatchedEvents: { buffer, ttlMs: 1_000 } },
      start: 'w',
      steps: {
        w: eventStep({
          on: { ping: ({ payload }: any) => ({ done: { got: payload } }) },
          next: 'end',
        }),
        end: runStep(),
      },
    })

  it('runs the event boundary, then reports delivery / buffering / drop', async () => {
    const { run, events } = make(waitFlow())
    await run.start()
    const bad = await run.send('ping', { id: 5 })
    expect(bad).toEqual({
      ok: false,
      reason: 'rejected',
      code: 'BOUNDARY_REJECTED',
      message: "the payload of 'ping' was rejected by its event boundary: id: id must be a string",
      issues: [{ message: 'id must be a string', path: ['id'] }],
    })
    expect(types(events)).toContain('event.rejected')

    const early = await run.send('other', { id: 'o1' })
    expect(early).toEqual({ ok: true, delivered: [], buffered: true, seq: run.getState().seq })

    const good = await run.send('ping', { id: 'p1' }, { correlationId: 'c1' })
    // Resolves when the routing batch commits (event.received + event.delivered), not when the handler finishes.
    const delivered = events.find((e) => e.type === 'event.delivered' && e.event === 'ping')!
    expect(good).toEqual({ ok: true, delivered: ['w'], buffered: false, seq: delivered.seq })
    expect(run.getState().seq).toBeGreaterThan(delivered.seq)
    expect(events.find((e) => e.type === 'event.received' && e.event === 'ping')).toMatchObject({
      payload: { id: 'p1' },
      correlationId: 'c1',
    })
    expect(run.getState().steps.w!.output).toEqual({ got: { id: 'p1' } })
    expect(run.getState().status).toBe('done')
  })

  it('drops when nothing listens and buffering is off; unknown events are programmer errors', async () => {
    const { run } = make(waitFlow(false))
    await run.start()
    expect(await run.send('other', { id: 'x' })).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'NOT_ACTIVE',
      message: "no step is waiting for 'other' and unmatched events are not buffered",
    })
    await expect(run.send('unknown', {})).rejects.toBeInstanceOf(WizardError)
    await expect(run.send('unknown', {})).rejects.toMatchObject({ code: 'UNKNOWN_EVENT' })
  })

  it('dispatch({ type: "send" }) goes through the same boundary door', async () => {
    const { run } = make(waitFlow())
    await run.start()
    expect(await run.dispatch({ type: 'send', event: 'ping', payload: { id: 1 } })).toMatchObject({
      ok: false,
      code: 'BOUNDARY_REJECTED',
      issues: [{ message: 'id must be a string' }],
    })
    expect(await run.dispatch({ type: 'send', event: 'zzz', payload: {} })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_EVENT',
    })
    const seqBefore = run.getState().seq
    // Routing batch = event.received + event.delivered → seq + 2.
    expect(await run.dispatch({ type: 'send', event: 'ping', payload: { id: 'ok' } })).toEqual({
      ok: true,
      seq: seqBefore + 2,
    })
  })
})

describe('run runtime: validate() is a pure query', () => {
  it('returns boundary issues, then validate-hook issues, without touching state or events', async () => {
    const def = flow({
      start: 'a',
      steps: {
        a: view({
          validate: ({ input }: any) =>
            input.name === 'bad' ? [{ message: 'bad name' }] : undefined,
          input: stringsBoundary('name'),
        }),
      },
    })
    const { run, events } = make(def)
    await run.start()
    await run.setInput('a', { name: 1 })
    const before = events.length
    expect(await run.validate('a')).toEqual([{ message: 'name must be a string', path: ['name'] }])
    await run.setInput('a', { name: 'bad' })
    expect(await run.validate('a')).toEqual([{ message: 'bad name' }])
    await run.setInput('a', { name: 'good' })
    expect(await run.validate('a')).toEqual([])
    expect(events.length - before).toBe(2) // only the two setInput batches
    await expect(run.validate('nope')).rejects.toMatchObject({ code: 'UNKNOWN_STEP' })
  })
})
