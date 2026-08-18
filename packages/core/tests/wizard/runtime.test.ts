import { describe, expect, it } from 'vitest'
import type { CompiledFlow } from '../../src/authoring/compiled'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { DomainEvent } from '../../src/machine/events'
import type { WizardState } from '../../src/machine/state'
import { createWizardRuntime, type WizardRuntimeOptions } from '../../src/wizard/runtime'
import {
  createToyMachine,
  flow,
  initialState,
  stringsBoundary,
  type ToyOverrides,
  types,
} from '../helpers/fake-machine'

function make(
  def: CompiledFlow,
  opts: Partial<WizardRuntimeOptions> = {},
  overrides: ToyOverrides = {},
) {
  const sched = createTestScheduler({ now: 1_000 })
  const wizard = createWizardRuntime(def, {
    context: { tenant: 't1' },
    machine: createToyMachine(overrides),
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...opts,
  })
  const events: DomainEvent[] = []
  const states: WizardState[] = []
  wizard.observe((e) => events.push(e))
  wizard.subscribe((s) => states.push(s))
  return { wizard, sched, events, states }
}

const twoViews = (extra: Record<string, any> = {}) =>
  flow({
    steps: {
      a: { kind: 'view', next: { kind: 'static', targets: ['b'] }, ...extra.a },
      b: { kind: 'view', next: { kind: 'static', targets: ['end'] }, ...extra.b },
      end: { kind: 'final' },
    },
  })

describe('wizard runtime: identity and options', () => {
  it('exposes id, path and epoch; a TestScheduler doubles as the clock', async () => {
    const { wizard, sched, events } = make(twoViews())
    expect(wizard.id).toBe('wiz-1')
    expect(wizard.path).toEqual([])
    expect(wizard.epoch).toBe(0)
    sched.advance(25)
    await wizard.start()
    expect(events[0]?.at).toBe(1_025)
  })

  it('start() resolves { ok, seq } and a second start is a rejected command', async () => {
    const { wizard, states } = make(twoViews())
    const r1 = await wizard.start()
    expect(r1).toEqual({ ok: true, seq: 3 })
    expect(states).toHaveLength(1)
    const r2 = await wizard.start()
    expect(r2).toEqual({ ok: false, code: 'INVALID_COMMAND', message: 'already started' })
  })
})

describe('wizard runtime: dispatch result mapping', () => {
  it('maps command.rejected to { ok: false, code, message, step }', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    const r = await wizard.retry('a')
    expect(r).toEqual({ ok: false, code: 'NOT_A_TASK', message: 'not a failed task', step: 'a' })
    // Unknown codes degrade to INVALID_COMMAND.
    const custom = make(
      twoViews(),
      {},
      {
        decide: (_e, _s, msg) =>
          msg.type === 'runReady'
            ? [{ type: 'command.rejected', command: msg, reason: 'nope', code: 'WHATEVER' }]
            : undefined,
      },
    )
    await custom.wizard.start()
    expect(await custom.wizard.runReady()).toEqual({
      ok: false,
      code: 'INVALID_COMMAND',
      message: 'nope',
    })
  })

  it('a message the machine ignores resolves { ok: true } with the current seq', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    expect(await wizard.runReady()).toEqual({ ok: true, seq: 3 })
    expect(await wizard.compensate({ reason: 'x' })).toEqual({ ok: true, seq: 3 })
  })

  it('validates wire shapes: invalid input never throws', async () => {
    const { wizard } = make(twoViews())
    const r = await wizard.dispatch({ type: 'go' } as any)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect((r as any).issues[0]).toMatchObject({ path: ['step'] })
    const r2 = await wizard.dispatch('nonsense' as any)
    expect(r2).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
  })

  it('setInput/resetInput/cancel are plain command results', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    expect(await wizard.setInput('a', { name: 'x' })).toEqual({ ok: true, seq: 4 })
    expect(wizard.getState().steps.a!.input).toEqual({ name: 'x' })
    expect(await wizard.setInput('end', {})).toMatchObject({ ok: false, code: 'NOT_A_VIEW' })
    expect(await wizard.cancel('bye')).toEqual({ ok: true, seq: 7 })
    expect(wizard.getState().status).toBe('cancelled')
    expect(await wizard.next()).toMatchObject({
      ok: false,
      reason: 'flow-terminal',
      code: 'FLOW_TERMINAL',
    })
  })
})

describe('wizard runtime: navigation promises', () => {
  it('a fully synchronous next() commits before the promise is awaited and resolves via the batch', async () => {
    const { wizard, events } = make(twoViews())
    await wizard.start()
    const p = wizard.next()
    // Sync-commit guarantee at the façade level.
    expect(wizard.getState().current).toBe('b')
    const r = await p
    expect(r).toEqual({ ok: true, from: 'a', to: 'b', seq: 8 })
    expect(types(events)).toContain('transition.committed')
  })

  it('an async canExit settles the nav promise later; false → guard rejection; throw → failed', async () => {
    let answer: unknown = true
    const def = twoViews({ a: { hooks: { canExit: () => Promise.resolve(answer) } } })
    const { wizard } = make(def)
    await wizard.start()

    const p = wizard.next()
    expect(wizard.getState().nav.phase).toBe('canExit')
    expect(wizard.getState().current).toBe('a')
    expect(await p).toMatchObject({ ok: true, from: 'a', to: 'b' })

    // back to a with a scripted go
    await wizard.go('a')
    answer = false
    expect(await wizard.next()).toMatchObject({
      ok: false,
      reason: 'guard-canExit',
      code: 'GUARD_BLOCKED',
      step: 'a',
    })
    answer = Promise.reject(new Error('guard exploded'))
    const failed = await wizard.next()
    expect(failed).toMatchObject({
      ok: false,
      reason: 'failed',
      code: 'HOOK_FAILED',
      message: 'guard exploded',
      step: 'a',
    })
  })

  it('nav-busy, not-active and unknown-step rejections carry reason + code', async () => {
    const def = twoViews({ a: { hooks: { canExit: () => new Promise(() => {}) } } })
    const { wizard } = make(def)
    expect(await wizard.next()).toMatchObject({
      ok: false,
      reason: 'flow-not-started',
      code: 'FLOW_NOT_STARTED',
    })
    await wizard.start()
    void wizard.next() // hangs in canExit
    expect(await wizard.next()).toMatchObject({ ok: false, reason: 'nav-busy', code: 'NAV_BUSY' })
    expect(await wizard.go('nope')).toMatchObject({ ok: false, code: 'UNKNOWN_STEP' })
    expect(await wizard.go('end')).toMatchObject({
      ok: false,
      reason: 'not-a-view',
      code: 'NOT_A_VIEW',
      step: 'end',
    })
  })

  it('dispatch() of a nav command maps the NavResult to a CommandResult', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    expect(await wizard.dispatch({ type: 'next' })).toEqual({ ok: true, seq: 8 })
    expect(await wizard.dispatch({ type: 'go', step: 'end' })).toMatchObject({
      ok: false,
      code: 'NOT_A_VIEW',
      step: 'end',
    })
  })
})

describe('wizard runtime: external events', () => {
  const waitFlow = (buffer = true) =>
    flow({
      events: { ping: stringsBoundary('id'), other: stringsBoundary('id') },
      policies: { unmatchedEvents: { buffer, ttlMs: 1_000 } },
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: ({ payload }: any) => ({ done: { got: payload } }) } },
          next: { kind: 'static', targets: ['end'] },
        },
        end: { kind: 'final' },
      },
    })

  it('runs the event boundary, then reports delivery / buffering / drop', async () => {
    const { wizard, events } = make(waitFlow())
    await wizard.start()
    const bad = await wizard.send('ping', { id: 5 })
    expect(bad).toEqual({
      ok: false,
      reason: 'rejected',
      code: 'BOUNDARY_REJECTED',
      message: 'payload rejected by the event boundary',
      issues: [{ message: 'id must be a string', path: ['id'] }],
    })
    expect(types(events)).toContain('event.rejected')

    const early = await wizard.send('other', { id: 'o1' })
    expect(early).toEqual({ ok: true, delivered: [], buffered: true, seq: wizard.getState().seq })

    const good = await wizard.send('ping', { id: 'p1' }, { correlationId: 'c1' })
    // Resolves when the routing batch commits (event.received + event.delivered), not when the handler finishes.
    const delivered = events.find((e) => e.type === 'event.delivered' && e.event === 'ping')!
    expect(good).toEqual({ ok: true, delivered: ['w'], buffered: false, seq: delivered.seq })
    expect(wizard.getState().seq).toBeGreaterThan(delivered.seq)
    expect(events.find((e) => e.type === 'event.received' && e.event === 'ping')).toMatchObject({
      payload: { id: 'p1' },
      correlationId: 'c1',
    })
    expect(wizard.getState().steps.w!.output).toEqual({ got: { id: 'p1' } })
    expect(wizard.getState().status).toBe('done')
  })

  it('drops when nothing listens and buffering is off; unknown events are programmer errors', async () => {
    const { wizard } = make(waitFlow(false))
    await wizard.start()
    expect(await wizard.send('other', { id: 'x' })).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'NOT_ACTIVE',
      message: 'no-listener',
    })
    await expect(wizard.send('unknown', {})).rejects.toBeInstanceOf(WizardError)
    await expect(wizard.send('unknown', {})).rejects.toMatchObject({ code: 'UNKNOWN_EVENT' })
  })

  it('dispatch({ type: "send" }) goes through the same boundary door', async () => {
    const { wizard } = make(waitFlow())
    await wizard.start()
    expect(
      await wizard.dispatch({ type: 'send', event: 'ping', payload: { id: 1 } }),
    ).toMatchObject({
      ok: false,
      code: 'BOUNDARY_REJECTED',
      issues: [{ message: 'id must be a string' }],
    })
    expect(await wizard.dispatch({ type: 'send', event: 'zzz', payload: {} })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_EVENT',
    })
    const seqBefore = wizard.getState().seq
    // Routing batch = event.received + event.delivered → seq + 2.
    expect(await wizard.dispatch({ type: 'send', event: 'ping', payload: { id: 'ok' } })).toEqual({
      ok: true,
      seq: seqBefore + 2,
    })
  })
})

describe('wizard runtime: validate() is a pure query', () => {
  it('returns boundary issues, then validate-hook issues, without touching state or events', async () => {
    const def = flow({
      steps: {
        a: {
          kind: 'view',
          input: stringsBoundary('name'),
          hooks: {
            validate: ({ input }: any) =>
              input.name === 'bad' ? [{ message: 'bad name' }] : undefined,
          },
        },
      },
    })
    const { wizard, events } = make(def)
    await wizard.start()
    await wizard.setInput('a', { name: 1 })
    const before = events.length
    expect(await wizard.validate('a')).toEqual([
      { message: 'name must be a string', path: ['name'] },
    ])
    await wizard.setInput('a', { name: 'bad' })
    expect(await wizard.validate('a')).toEqual([{ message: 'bad name' }])
    await wizard.setInput('a', { name: 'good' })
    expect(await wizard.validate('a')).toEqual([])
    expect(events.length - before).toBe(2) // only the two setInput batches
    await expect(wizard.validate('nope')).rejects.toMatchObject({ code: 'UNKNOWN_STEP' })
  })
})
